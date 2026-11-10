// Ball Boi's DeviceCheck token (Wave 2, Session G; device bans, #204).
// Kept in apple/, not ios/, because the app's .gitignore drops every ios/
// folder (that is how the first copy of this file was lost).
//
// JavaScript (modules/device-check/index.ts) calls:
// - isSupported(): true where Apple's DeviceCheck works on this phone
// - generateTokenAsync(): a fresh DeviceCheck token, base64 (no line breaks),
//   which the API sends to Apple to read or set this phone's two bits
// Nothing here stores the token or learns which iPhone it is.

import DeviceCheck
import ExpoModulesCore

public class BallBoiDeviceCheckModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BallBoiDeviceCheck")

    Function("isSupported") { () -> Bool in
      DCDevice.current.isSupported
    }

    AsyncFunction("generateTokenAsync") { (promise: Promise) in
      let device = DCDevice.current
      guard device.isSupported else {
        promise.reject("ERR_DEVICE_CHECK_UNSUPPORTED", "DeviceCheck isn't available on this device")
        return
      }
      device.generateToken { data, error in
        if let error = error {
          promise.reject("ERR_DEVICE_CHECK_TOKEN", error.localizedDescription)
          return
        }
        guard let data = data, !data.isEmpty else {
          promise.reject("ERR_DEVICE_CHECK_TOKEN", "DeviceCheck returned no token")
          return
        }
        promise.resolve(data.base64EncodedString())
      }
    }
  }
}
