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
      var detectedCardRect: CGRect?
      let request = VNRecognizeTextRequest { request, error in
        if let error = error { promise.reject("VISION_ERROR", error.localizedDescription); return }
        let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
        let boxes: [[String: Any]] = observations.compactMap { observation in
          guard let text = observation.topCandidates(1).first?.string else { return nil }
          return [
            "text": text,
            "x": observation.boundingBox.origin.x,
            "y": observation.boundingBox.origin.y,
            "width": observation.boundingBox.width,
            "height": observation.boundingBox.height
          ]
        }
        let lines = boxes.compactMap { $0["text"] as? String }
        var payload: [String: Any] = [
          "text": lines.joined(separator: "\n"),
          "lines": lines,
          "boxes": boxes,
          "cardDetected": detectedCardRect != nil
        ]
        if let rect = detectedCardRect {
          payload["cardBounds"] = ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
        }
        promise.resolve(payload)
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      request.recognitionLanguages = ["en-US"]
      request.customWords = [
        "ex", "EX", "GX", "V", "VMAX", "VSTAR", "BREAK",
        "Mega", "Radiant", "Shining", "Hisuian", "Galarian", "Paldean"
      ]
      // Collector numbers and set codes are the smallest print on the card.
      // Keep the threshold low enough for the bottom-left line at full photo resolution.
      request.minimumTextHeight = 0.006
      let orientation = image.cgImageOrientation
      DispatchQueue.global(qos: .userInitiated).async {
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation)
        let rectangleRequest = VNDetectRectanglesRequest()
        rectangleRequest.maximumObservations = 3
        rectangleRequest.minimumConfidence = 0.55
        rectangleRequest.minimumAspectRatio = 0.55
        rectangleRequest.maximumAspectRatio = 0.82
        rectangleRequest.minimumSize = 0.28
        rectangleRequest.quadratureTolerance = 22
        do {
          try handler.perform([rectangleRequest])
          if let rectangles = rectangleRequest.results, let card = rectangles.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) {
            detectedCardRect = card.boundingBox
          }
          // OCR the full image so every returned text box uses the same image
          // coordinate space as the detected rectangle. Applying an ROI here
          // can produce region-relative boxes on some iOS versions.
          try handler.perform([request])
        }
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
