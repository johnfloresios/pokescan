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
        rectangleRequest.minimumConfidence = 0.48
        rectangleRequest.minimumAspectRatio = 0.55
        rectangleRequest.maximumAspectRatio = 0.82
        // Cards are intentionally framed farther from the lens. Accept a
        // smaller rectangle, then perspective-crop it to full OCR resolution.
        rectangleRequest.minimumSize = 0.16
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

            // Foil glare and gray copyright strips often have too little local
            // contrast for a single OCR pass. A sharpened monochrome variant
            // supplies independent glyph evidence without another camera frame.
            if let enhancedImage = enhancedForTinyText(cgImage: ocrImage) {
              let enhancedHandler = VNImageRequestHandler(cgImage: enhancedImage, orientation: ocrOrientation)
              let enhancedRequest = VNRecognizeTextRequest()
              enhancedRequest.recognitionLevel = .accurate
              enhancedRequest.usesLanguageCorrection = false
              enhancedRequest.recognitionLanguages = ["en-US"]
              enhancedRequest.customWords = bottomRequest.customWords
              enhancedRequest.minimumTextHeight = 0.0015
              enhancedRequest.regionOfInterest = collectorRegion
              try enhancedHandler.perform([enhancedRequest])
              bottomLines += (enhancedRequest.results ?? []).compactMap { $0.topCandidates(2).first?.string }
            }
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

    AsyncFunction("matchSetSymbols") { (path: String, candidatesJSON: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          guard let source = UIImage(contentsOfFile: path)?.normalizedForOCR.cgImage else {
            promise.reject("SYMBOL_IMAGE_ERROR", "The captured card image could not be read."); return
          }
          let flattened = detectAndFlattenCard(cgImage: source) ?? source
          guard let data = candidatesJSON.data(using: .utf8),
                let candidates = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            promise.reject("SYMBOL_INPUT_ERROR", "Set candidates were invalid."); return
          }
          let references = downloadReferenceImages(candidates: Array(candidates.prefix(5)))
          var results: [[String: Any]] = []
          for (index, candidate) in candidates.prefix(5).enumerated() {
            guard let reference = references[index],
                  let distance = symbolRegionDistance(captured: flattened, reference: reference) else { continue }
            // Feature-print distance is zero for identical regions. Require a
            // genuinely close visual match; JS also checks the winner's margin.
            let confidence = max(0.0, min(1.0, exp(-Double(distance) / 11.0)))
            results.append([
              "code": candidate["code"] as? String ?? "",
              "name": candidate["name"] as? String ?? "",
              "confidence": confidence,
              "distance": Double(distance)
            ])
          }
          results.sort { ($0["distance"] as? Double ?? 999) < ($1["distance"] as? Double ?? 999) }
          promise.resolve(results)
        } catch { promise.reject("SYMBOL_MATCH_ERROR", error.localizedDescription) }
      }
    }
  }
}

private func downloadReferenceImages(candidates: [[String: Any]]) -> [Int: CGImage] {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.timeoutIntervalForRequest = 1.5
  configuration.timeoutIntervalForResource = 2.0
  configuration.urlCache = URLCache(memoryCapacity: 8_000_000, diskCapacity: 32_000_000, diskPath: "nicepull-set-symbols")
  configuration.requestCachePolicy = .returnCacheDataElseLoad
  let session = URLSession(configuration: configuration)
  let group = DispatchGroup()
  let lock = NSLock()
  var images: [Int: CGImage] = [:]
  for (index, candidate) in candidates.enumerated() {
    guard let text = candidate["imageUrl"] as? String, let url = URL(string: text) else { continue }
    group.enter()
    session.dataTask(with: url) { data, _, _ in
      defer { group.leave() }
      guard let data, let image = UIImage(data: data)?.normalizedForOCR.cgImage else { return }
      lock.lock(); images[index] = image; lock.unlock()
    }.resume()
  }
  _ = group.wait(timeout: .now() + 2.2)
  session.invalidateAndCancel()
  return images
}

private func detectAndFlattenCard(cgImage: CGImage) -> CGImage? {
  let request = VNDetectRectanglesRequest()
  request.maximumObservations = 3
  request.minimumConfidence = 0.45
  request.minimumAspectRatio = 0.53
  request.maximumAspectRatio = 0.84
  request.minimumSize = 0.14
  request.quadratureTolerance = 24
  let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
  try? handler.perform([request])
  guard let card = request.results?.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) else { return nil }
  return perspectiveCorrect(cgImage: cgImage, rectangle: card)
}

private func featurePrint(cgImage: CGImage, region: CGRect) -> VNFeaturePrintObservation? {
  let input = CIImage(cgImage: cgImage)
  let extent = input.extent
  let crop = CGRect(x: extent.minX + region.minX * extent.width, y: extent.minY + region.minY * extent.height, width: region.width * extent.width, height: region.height * extent.height).intersection(extent)
  guard !crop.isEmpty,
        let cropped = CIContext(options: [.cacheIntermediates: false]).createCGImage(input.cropped(to: crop), from: crop) else { return nil }
  let request = VNGenerateImageFeaturePrintRequest()
  try? VNImageRequestHandler(cgImage: cropped, orientation: .up).perform([request])
  return request.results?.first as? VNFeaturePrintObservation
}

private func symbolRegionDistance(captured: CGImage, reference: CGImage) -> Float? {
  // Set-symbol placement changed across eras, so compare three small regions:
  // modern bottom-left, classic lower-right, and the classic artwork edge.
  let regions = [
    CGRect(x: 0.00, y: 0.00, width: 0.58, height: 0.24),
    CGRect(x: 0.54, y: 0.18, width: 0.46, height: 0.28),
    CGRect(x: 0.64, y: 0.36, width: 0.36, height: 0.25)
  ]
  var distances: [Float] = []
  for region in regions {
    guard let left = featurePrint(cgImage: captured, region: region),
          let right = featurePrint(cgImage: reference, region: region) else { continue }
    var distance: Float = 0
    if (try? left.computeDistance(&distance, to: right)) != nil { distances.append(distance) }
  }
  return distances.min()
}

private func enhancedForTinyText(cgImage: CGImage) -> CGImage? {
  let input = CIImage(cgImage: cgImage)
  guard let controls = CIFilter(name: "CIColorControls") else { return nil }
  controls.setValue(input, forKey: kCIInputImageKey)
  controls.setValue(0.0, forKey: kCIInputSaturationKey)
  controls.setValue(1.55, forKey: kCIInputContrastKey)
  controls.setValue(0.03, forKey: kCIInputBrightnessKey)
  guard let contrasted = controls.outputImage,
        let sharpen = CIFilter(name: "CISharpenLuminance") else { return nil }
  sharpen.setValue(contrasted, forKey: kCIInputImageKey)
  sharpen.setValue(0.65, forKey: kCIInputSharpnessKey)
  guard let output = sharpen.outputImage else { return nil }
  return CIContext(options: [.cacheIntermediates: false]).createCGImage(output, from: output.extent)
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
