import ExpoModulesCore
import Vision
import UIKit
import ImageIO
import CoreImage

public class CardTextRecognizerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardTextRecognizer")
    AsyncFunction("recognize") { (path: String, promise: Promise) in
      guard let sourceImage = UIImage(contentsOfFile: path) else {
        promise.reject("IMAGE_ERROR", "The captured image could not be read."); return
      }
      let image = sourceImage.normalizedForOCR
      guard let cgImage = image.cgImage else {
        promise.reject("IMAGE_ERROR", "The captured image could not be normalized."); return
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
          var ocrImage = cgImage
          var ocrOrientation = orientation
          if let rectangles = rectangleRequest.results, let card = rectangles.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) {
            detectedCardRect = card.boundingBox
            // Flatten the photographed quadrilateral before OCR. This removes
            // perspective skew and crops away sleeves/background distractions.
            if let corrected = perspectiveCorrect(cgImage: cgImage, rectangle: card) {
              ocrImage = corrected
              ocrOrientation = .up
              detectedCardRect = CGRect(x: 0, y: 0, width: 1, height: 1)
            }
          }
          let ocrHandler = VNImageRequestHandler(cgImage: ocrImage, orientation: ocrOrientation)
          try ocrHandler.perform([request])
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
            try ocrHandler.perform([titleRequest])
            titleLines = (titleRequest.results ?? []).compactMap { $0.topCandidates(1).first?.string }

            let bottomLeft = CGRect(x: card.minX, y: card.minY, width: card.width, height: card.height * 0.25)
            let bottomRequest = VNRecognizeTextRequest()
            bottomRequest.recognitionLevel = .accurate
            bottomRequest.usesLanguageCorrection = false
            bottomRequest.recognitionLanguages = ["en-US"]
            bottomRequest.customWords = ["SV2a", "SWSH", "SVI", "PAL", "OBF", "PAR", "TEF", "TWM", "SCR", "SSP", "PRE", "JTG", "DRI"]
            bottomRequest.minimumTextHeight = 0.003
            bottomRequest.regionOfInterest = bottomLeft
            try ocrHandler.perform([bottomRequest])
            bottomLines = (bottomRequest.results ?? []).compactMap { $0.topCandidates(1).first?.string }

            // A tighter second pass increases the apparent size of the tiny
            // collector number and set code printed in the lower-left strip.
            let collectorRegion = CGRect(x: card.minX, y: card.minY, width: card.width * 0.82, height: card.height * 0.16)
            let collectorRequest = VNRecognizeTextRequest()
            collectorRequest.recognitionLevel = .accurate
            collectorRequest.usesLanguageCorrection = false
            collectorRequest.recognitionLanguages = ["en-US"]
            collectorRequest.customWords = bottomRequest.customWords
            collectorRequest.minimumTextHeight = 0.002
            collectorRequest.regionOfInterest = collectorRegion
            try ocrHandler.perform([collectorRequest])
            bottomLines += (collectorRequest.results ?? []).compactMap { $0.topCandidates(1).first?.string }
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

private func perspectiveCorrect(cgImage: CGImage, rectangle: VNRectangleObservation) -> CGImage? {
  let input = CIImage(cgImage: cgImage)
  let extent = input.extent
  let point: (CGPoint) -> CIVector = { normalized in
    CIVector(x: extent.minX + normalized.x * extent.width, y: extent.minY + normalized.y * extent.height)
  }
  guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
  filter.setValue(input, forKey: kCIInputImageKey)
  filter.setValue(point(rectangle.topLeft), forKey: "inputTopLeft")
  filter.setValue(point(rectangle.topRight), forKey: "inputTopRight")
  filter.setValue(point(rectangle.bottomLeft), forKey: "inputBottomLeft")
  filter.setValue(point(rectangle.bottomRight), forKey: "inputBottomRight")
  guard let output = filter.outputImage else { return nil }
  return CIContext(options: [.cacheIntermediates: false]).createCGImage(output, from: output.extent)
}

private extension UIImage {
  var normalizedForOCR: UIImage {
    if imageOrientation == .up { return self }
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = scale
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      draw(in: CGRect(origin: .zero, size: size))
    }
  }

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
