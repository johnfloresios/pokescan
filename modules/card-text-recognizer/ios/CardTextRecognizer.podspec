Pod::Spec.new do |s|
  s.name = 'CardTextRecognizer'; s.version = '1.0.0'; s.summary = 'Apple Vision text recognition for NicePull'; s.description = s.summary
  s.license = { :type => 'MIT' }; s.author = 'NicePull'; s.homepage = 'https://example.com'; s.platform = :ios, '15.1'
  s.source = { git: '' }; s.static_framework = true; s.dependency 'ExpoModulesCore'; s.source_files = '**/*.{h,m,mm,swift}'
end
