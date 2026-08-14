import ExpoModulesCore
import Vision
import UIKit

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
      DispatchQueue.global(qos: .userInitiated).async {
        do { try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request]) }
        catch { promise.reject("VISION_ERROR", error.localizedDescription) }
      }
    }
  }
}
