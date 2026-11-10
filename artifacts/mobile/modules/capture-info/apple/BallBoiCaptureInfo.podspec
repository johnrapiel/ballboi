# Ball Boi capture info (recording sidecar, decision T5). Kept in apple/,
# not ios/, because the app's .gitignore drops every ios/ folder.
Pod::Spec.new do |s|
  s.name           = 'BallBoiCaptureInfo'
  s.version        = '1.0.0'
  s.summary        = 'Thermal state, delivered frame rate, dropped frames, exposure and HDR hold for Ball Boi recordings'
  s.author         = 'Ball Boi'
  s.homepage       = 'https://ballboi.tennis'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
  s.swift_version  = '5.9'
end
