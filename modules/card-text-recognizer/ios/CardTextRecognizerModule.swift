import ExpoModulesCore
import Vision
import UIKit
import ImageIO

public class CardTextRecognizerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardTextRecognizer")
    AsyncFunction("recognize") { (path: String, promise: Promise) in
      guard let image = UIImage(contentsOfFile: path), let cgImage = image.cgImage else {
        promise.reject("IMAGE_ERROR", "The captured image could not be read."); return
      }
      let request = VNRecognizeTextRequest { request, error in
        if let error = error { promise.reject("VISION_ERROR", error.localizedDescription); return }
        let lines = (request.results as? [VNRecognizedTextObservation])?.compactMap { $0.topCandidates(1).first?.string } ?? []
        promise.resolve(["text": lines.joined(separator: "\n"), "lines": lines])
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      request.recognitionLanguages = ["en-US"]
      request.customWords = [
        "ex", "EX", "GX", "V", "VMAX", "VSTAR", "BREAK",
        "Mega", "Radiant", "Shining", "Hisuian", "Galarian", "Paldean"
      ]
      request.minimumTextHeight = 0.012
      let orientation = image.cgImageOrientation
      DispatchQueue.global(qos: .userInitiated).async {
        do { try VNImageRequestHandler(cgImage: cgImage, orientation: orientation).perform([request]) }
        catch { promise.reject("VISION_ERROR", error.localizedDescription) }
      }
    }
  }
}

private extension UIImage {
  var cgImageOrientation: CGImagePropertyOrientation {
    switch imageOrientation {
    case .up: return .up
    case .upMirrored: return .upMirrored
    case .down: return .down
    case .downMirrored: return .downMirrored
    case .left: return .left
    case .leftMirrored: return .leftMirrored
    case .right: return .right
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
