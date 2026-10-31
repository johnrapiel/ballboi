"""
Read match video straight from R2 (or any S3-compatible store) with the same
S3_* settings the API uses. No SDK: requests are signed with AWS Signature V4
using the standard library, which keeps the ML image small.

Object paths in the database look like "/objects/uploads/<uuid>"; the bucket
key is the part after "/objects/", same as api-server/src/lib/objectStorage.ts.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
import shutil
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass

OBJECT_PATH_PREFIX = "/objects/"


class StorageNotConfigured(RuntimeError):
    pass


@dataclass
class S3Config:
    bucket: str
    access_key: str
    secret_key: str
    region: str = "auto"
    endpoint: str | None = None

    @classmethod
    def from_env(cls) -> "S3Config":
        bucket = os.environ.get("S3_BUCKET")
        access = os.environ.get("S3_ACCESS_KEY_ID")
        secret = os.environ.get("S3_SECRET_ACCESS_KEY")
        if not (bucket and access and secret):
            raise StorageNotConfigured("Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (see .env.example).")
        return cls(bucket=bucket, access_key=access, secret_key=secret,
                   region=os.environ.get("S3_REGION") or "auto",
                   endpoint=(os.environ.get("S3_ENDPOINT") or None))

    @property
    def base_url(self) -> str:
        if self.endpoint:
            return self.endpoint.rstrip("/")
        return f"https://s3.{self.region}.amazonaws.com"


def object_key(path_or_key: str) -> str:
    if path_or_key.startswith(OBJECT_PATH_PREFIX):
        return path_or_key[len(OBJECT_PATH_PREFIX):]
    return path_or_key.lstrip("/")


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def presign(cfg: S3Config, key: str, method: str = "GET", expires: int = 3600,
            query: dict[str, str] | None = None, now: dt.datetime | None = None) -> str:
    """Presigned URL (path-style), AWS Signature Version 4, query-string auth."""
    now = now or dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    parsed = urllib.parse.urlparse(cfg.base_url)
    host = parsed.netloc
    base_path = parsed.path.rstrip("/")
    path = f"{base_path}/{cfg.bucket}" + (f"/{urllib.parse.quote(key, safe='/~')}" if key else "")
    scope = f"{datestamp}/{cfg.region}/s3/aws4_request"
    params = {
        **(query or {}),
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{cfg.access_key}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": "host",
    }
    canonical_query = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}" for k, v in sorted(params.items())
    )
    canonical_request = "\n".join([method, path, canonical_query, f"host:{host}\n", "host", "UNSIGNED-PAYLOAD"])
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])
    k = _sign(("AWS4" + cfg.secret_key).encode(), datestamp)
    k = _sign(k, cfg.region)
    k = _sign(k, "s3")
    k = _sign(k, "aws4_request")
    signature = hmac.new(k, string_to_sign.encode(), hashlib.sha256).hexdigest()
    return f"{parsed.scheme}://{host}{path}?{canonical_query}&X-Amz-Signature={signature}"


def download(path_or_key: str, cfg: S3Config | None = None, dest_dir: str | None = None) -> str:
    """Streams an object to a temp file and returns its path. The caller deletes it."""
    cfg = cfg or S3Config.from_env()
    key = object_key(path_or_key)
    suffix = os.path.splitext(key)[1] or ".mp4"
    fd, tmp = tempfile.mkstemp(suffix=suffix, dir=dest_dir)
    try:
        with urllib.request.urlopen(presign(cfg, key), timeout=60) as resp, os.fdopen(fd, "wb") as out:
            shutil.copyfileobj(resp, out, length=1 << 20)
    except Exception:
        os.unlink(tmp)
        raise
    return tmp


def upload(local_path: str, path_or_key: str, cfg: S3Config | None = None,
           content_type: str = "video/mp4") -> str:
    """Streams a local file to the bucket with a presigned PUT. Returns the "/objects/<key>" path."""
    cfg = cfg or S3Config.from_env()
    key = object_key(path_or_key)
    size = os.path.getsize(local_path)
    with open(local_path, "rb") as body:
        req = urllib.request.Request(presign(cfg, key, method="PUT"), data=body, method="PUT",
                                     headers={"Content-Length": str(size), "Content-Type": content_type})
        with urllib.request.urlopen(req, timeout=600) as resp:
            if resp.status >= 300:
                raise OSError(f"Upload failed with HTTP {resp.status}")
    return OBJECT_PATH_PREFIX + key


def list_keys(prefix: str, cfg: S3Config | None = None) -> list[str]:
    """Every key under a prefix (ListObjectsV2, paged)."""
    cfg = cfg or S3Config.from_env()
    keys: list[str] = []
    token = None
    while True:
        query = {"list-type": "2", "prefix": prefix, "encoding-type": "url"}
        if token:
            query["continuation-token"] = token
        with urllib.request.urlopen(presign(cfg, "", query=query), timeout=60) as resp:
            root = ET.fromstring(resp.read())
        ns = {"s3": root.tag.split("}")[0].strip("{")} if root.tag.startswith("{") else {}
        find = (lambda el, tag: el.find(f"s3:{tag}", ns)) if ns else (lambda el, tag: el.find(tag))
        findall = (lambda el, tag: el.findall(f"s3:{tag}", ns)) if ns else (lambda el, tag: el.findall(tag))
        keys += [urllib.parse.unquote_plus(find(c, "Key").text) for c in findall(root, "Contents")]
        truncated = find(root, "IsTruncated")
        if truncated is None or truncated.text != "true":
            return keys
        token = find(root, "NextContinuationToken").text
