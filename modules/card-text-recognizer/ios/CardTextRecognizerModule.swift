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
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      request.recognitionLanguages = ["en-US"]
      request.customWords = [
        "ex", "EX", "GX", "V", "VMAX", "VSTAR", "BREAK",
        "Mega", "Radiant", "Shining", "Hisuian", "Galarian", "Paldean",
        "TRAINER", "Item", "Supporter", "Stadium", "Basic Energy", "Special Energy",
        "Energy Retrieval", "Rare Candy", "Ultra Ball", "Professor's Research"
      ]
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
          try handler.perform([request])
          let observations = request.results ?? []
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
          var bottomLines: [String] = []
          var titleLines: [String] = []
          if let card = detectedCardRect {
            // Run dedicated high-resolution passes over the two identifiers
            // that matter most: the printed title and the tiny bottom edge.
            let titleRegion = CGRect(x: card.minX, y: card.minY + card.height * 0.76, width: card.width, height: card.height * 0.24)
            let titleRequest = VNRecognizeTextRequest()
            titleRequest.recognitionLevel = .accurate
            titleRequest.usesLanguageCorrection = true
            titleRequest.recognitionLanguages = ["en-US"]
            titleRequest.customWords = request.customWords
            titleRequest.minimumTextHeight = 0.004
            titleRequest.regionOfInterest = titleRegion
            try handler.perform([titleRequest])
            titleLines = (titleRequest.results ?? []).compactMap { $0.topCandidates(1).first?.string }

            let bottomLeft = CGRect(x: card.minX, y: card.minY, width: card.width, height: card.height * 0.20)
            let bottomRequest = VNRecognizeTextRequest()
            bottomRequest.recognitionLevel = .accurate
            bottomRequest.usesLanguageCorrection = false
            bottomRequest.recognitionLanguages = ["en-US"]
            bottomRequest.customWords = ["SV2a", "SWSH", "SVI", "PAL", "OBF", "PAR", "TEF", "TWM", "SCR", "SSP", "PRE", "JTG", "DRI"]
            bottomRequest.minimumTextHeight = 0.003
            bottomRequest.regionOfInterest = bottomLeft
            try handler.perform([bottomRequest])
            bottomLines = (bottomRequest.results ?? []).compactMap { $0.topCandidates(1).first?.string }
          }
        var payload: [String: Any] = [
          "text": (titleLines + lines + bottomLines).joined(separator: "\n"),
          "lines": lines,
          "boxes": boxes,
            "bottomText": bottomLines.joined(separator: "\n"),
          "cardDetected": detectedCardRect != nil
        ]
        if let rect = detectedCardRect {
          payload["cardBounds"] = ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
        }
        promise.resolve(payload)
        } catch { promise.reject("VISION_ERROR", error.localizedDescription) }
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
