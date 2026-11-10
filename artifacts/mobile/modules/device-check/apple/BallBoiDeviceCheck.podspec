# Ball Boi DeviceCheck token (device bans, #204). Kept in apple/, not ios/,
# because the app's .gitignore drops every ios/ folder.
Pod::Spec.new do |s|
  s.name           = 'BallBoiDeviceCheck'
  s.version        = '1.0.0'
  s.summary        = 'Apple DeviceCheck token for Ball Boi device bans'
  s.author         = 'Ball Boi'
  s.homepage       = 'https://ballboi.tennis'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'DeviceCheck'
  s.source_files   = '**/*.swift'
  s.swift_version  = '5.9'
end
