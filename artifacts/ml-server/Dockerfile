# Ball Boi ML server. Runs on any machine with Docker, including Intel Macs
# (current PyTorch no longer ships for Intel Macs; this image is Linux).
#
#   docker build -t ballboi-ml artifacts/ml-server      # first build downloads ~250 MB of models
#   docker run --rm -p 8000:8000 --env-file .env ballboi-ml
#
# Stage 1 downloads and exports the models with PyTorch (CPU). Stage 2 runs them
# with ONNX Runtime only, so the server image stays small.

FROM python:3.11-slim AS models
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir "numpy<2.3" pyyaml==6.0.2 gdown==5.2.0 onnx==1.17.0 onnxruntime==1.20.1
WORKDIR /build
COPY scripts/fetch_models.py scripts/export_wasb_onnx.py ./scripts/
RUN python scripts/fetch_models.py --out /models

FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=models /models /app/models
ENV BALLBOI_MODELS_DIR=/app/models \
    PORT=8000 \
    PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "main.py"]
