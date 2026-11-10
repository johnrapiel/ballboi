// Ball Boi capture info (shot tracker test plan, decision T5), for the
// recording's metadata sidecar. What JavaScript can't read:
// - thermalState and its changes (ProcessInfo)
// - videoInfo(uri): the delivered frame rate and dropped frames, read from a
//   saved piece's own frame timestamps (passthrough, no decoding), plus codec,
//   size and bitrate
// - holdExposure(locked): locks exposure on the back wide camera at court
//   lock, and turns video HDR off, so the picture doesn't shift while it
//   records (shot analyst, Nov 9). AVCaptureDevice objects are shared, so this
//   is the same device expo-camera records with when the wide lens is pinned.
// Nothing here starts or changes the capture session itself.

import AVFoundation
import ExpoModulesCore

public class BallBoiCaptureInfoModule: Module {
  private var thermalObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("BallBoiCaptureInfo")

    Events("onThermalChange")

    Function("thermalState") { () -> String in
      Self.name(ProcessInfo.processInfo.thermalState)
    }

    OnStartObserving {
      self.thermalObserver = NotificationCenter.default.addObserver(
        forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onThermalChange", ["state": Self.name(ProcessInfo.processInfo.thermalState)])
      }
    }

    OnStopObserving {
      if let o = self.thermalObserver { NotificationCenter.default.removeObserver(o) }
      self.thermalObserver = nil
    }

    AsyncFunction("videoInfo") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .utility).async {
        do {
          promise.resolve(try Self.videoInfo(uri))
        } catch {
          promise.reject("ERR_VIDEO_INFO", error.localizedDescription)
        }
      }
    }

    Function("holdExposure") { (locked: Bool) -> [String: Any?] in
      Self.holdExposure(locked)
    }
  }

  static func name(_ s: ProcessInfo.ThermalState) -> String {
    switch s {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "nominal"
    }
  }

  static func videoInfo(_ uri: String) throws -> [String: Any?] {
    guard let url = URL(string: uri), url.isFileURL || uri.hasPrefix("/") else {
      throw NSError(domain: "BallBoiCaptureInfo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Not a file"])
    }
    let fileURL = url.isFileURL ? url : URL(fileURLWithPath: uri)
    let asset = AVURLAsset(url: fileURL)
    guard let track = asset.tracks(withMediaType: .video).first else {
      throw NSError(domain: "BallBoiCaptureInfo", code: 2, userInfo: [NSLocalizedDescriptionKey: "No video track"])
    }
    let duration = CMTimeGetSeconds(asset.duration)
    let nominal = Double(track.nominalFrameRate)
    let expected = CMTimeGetSeconds(track.minFrameDuration)
    let frameGap = expected.isFinite && expected > 0 ? expected : (nominal > 0 ? 1.0 / nominal : 1.0 / 30.0)

    // Walk the frame timestamps without decoding: count frames and gaps.
    var frames = 0
    var dropped: [Int] = []
    if let reader = try? AVAssetReader(asset: asset) {
      let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
      output.alwaysCopiesSampleData = false
      if reader.canAdd(output) {
        reader.add(output)
        reader.startReading()
        var last: Double? = nil
        while let buffer = output.copyNextSampleBuffer() {
          let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer))
          if CMSampleBufferGetNumSamples(buffer) == 0 || !t.isFinite { continue }
          frames += 1
          if let prev = last {
            let gap = t - prev
            // A gap of 1.5 frames or more means frames were dropped.
            if gap >= frameGap * 1.5 {
              let missing = Int((gap / frameGap).rounded()) - 1
              let minute = max(0, Int(t / 60))
              while dropped.count <= minute { dropped.append(0) }
              dropped[minute] += max(0, missing)
            }
          }
          last = t
        }
      }
    }
    let minutes = max(1, Int(ceil(duration / 60)))
    while dropped.count < minutes { dropped.append(0) }

    let codec: String? = (track.formatDescriptions.first).map { desc in
      let fourCC = CMFormatDescriptionGetMediaSubType(desc as! CMFormatDescription)
      let bytes = [24, 16, 8, 0].map { Character(UnicodeScalar(UInt8((fourCC >> $0) & 0xff))) }
      return String(bytes)
    }
    let size = track.naturalSize
    return [
      "durationSeconds": duration,
      "nominalFps": nominal,
      "frames": frames,
      "deliveredFps": duration > 0 && frames > 0 ? Double(frames) / duration : nil,
      "droppedFramesByMinute": dropped,
      "codec": codec,
      "width": Int(abs(size.width)),
      "height": Int(abs(size.height)),
      "bitrate": Double(track.estimatedDataRate),
    ]
  }

  static func holdExposure(_ locked: Bool) -> [String: Any?] {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      return ["exposureLocked": nil, "hdr": nil]
    }
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      if locked {
        if device.isExposureModeSupported(.locked) { device.exposureMode = .locked }
      } else if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
      // HDR off while recording: it changes the picture as the light changes.
      if device.activeFormat.isVideoHDRSupported {
        device.automaticallyAdjustsVideoHDREnabled = false
        device.isVideoHDREnabled = false
      }
    } catch {
      // Another part of the app holds the device right now; report what it is.
    }
    let hdr: Bool? = device.activeFormat.isVideoHDRSupported ? device.isVideoHDREnabled : false
    return ["exposureLocked": device.exposureMode == .locked, "hdr": hdr]
  }
}
