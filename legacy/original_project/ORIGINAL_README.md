# SafeVision AI – PPE Detection

## Overview
SafeVision AI is a real-time Personal Protective Equipment (PPE) detection system designed to improve workplace safety and compliance. The system uses a YOLOv8-based computer vision model to detect hardhats, masks, safety vests, and gloves from live video streams or webcam input. It supports automated identification of safety violations and reduces the need for manual inspections.

This project demonstrates applied computer vision, deep learning inference, and real-time video processing using Python.

---

## Features
- Real-time PPE detection from webcam or video streams  
- Detection of hardhats, masks, vests, and gloves  
- High-performance object detection using YOLOv8  
- Automated flagging of PPE non-compliance  
- Suitable for safety and compliance monitoring use cases (OSHA, WSIB, CSA)

---

## Tech Stack
- Python  
- YOLOv8  
- OpenCV  
- PyTorch  
- NumPy  
- Matplotlib  
- Google Colab  

---

## How It Works
1. Video frames are captured from a webcam or video file using OpenCV.
2. Frames are passed to a YOLOv8 model for real-time inference.
3. Detected PPE items are identified and labeled with bounding boxes.
4. Frames missing required PPE are flagged as non-compliant.
5. The annotated video feed is displayed live.

---


---

## Results
- Achieved approximately 94% detection accuracy across PPE categories  
- Demonstrated real-time inference performance  
- Validated applicability for automated safety monitoring

---

## Future Improvements
- Expand PPE categories and detection rules  
- Deploy as a web or edge-based application  
- Integrate alerting and reporting systems  
- Optimize inference speed for low-power devices  

---

By: Hamza Khan
