from ultralytics import YOLO
import cv2
import cvzone
import math

cap = cv2.VideoCapture(1)
cap.set(3, 1800)
cap.set(4, 800)

model = YOLO("../../ml/weights/ppe.pt")

classNames = [
    'Excavator', 'Gloves', 'Hardhat', 'Ladder', 'Mask', 'NO-Hardhat', 'NO-Mask', 'NO-Safety Vest', 'Person', 'SUV', 'Safety Cone', 'Safety Vest', 'bus', 'dump truck', 'fire hydrant', 'machinery', 'mini-van', 'sedan', 'semi', 'trailer', 'truck and trailer', 'truck', 'van', 'vehicle', 'wheel loader'
]

myColor= (255,255,0)

while True:
    success, img = cap.read()
    results= model(img,stream=True)
    for r in results:
        boxes = r.boxes
        for box in boxes:

            #Bounding Box
            x1,y1,x2,y2 = box.xyxy[0]
            x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
            #cv2.rectangle(img, (x1, y1), (x2, y2), (255, 0, 255), 3)

            w,h =x2-x1,y2-y1
            bbox = int(x1),int(y1),int(w),int(h)
            cvzone.cornerRect(img,(x1,y1,w,h))

            #Confidence
            conf= math.ceil((box.conf[0]*100))/100

            #Class Name
            cls = int(box.cls[0])

            currentClass= classNames[cls]
            print(currentClass)
            if conf>0.5:

                if currentClass == 'Hardhat' or currentClass == 'Safety Vest' or currentClass == 'Mask' or currentClass == 'Gloves':
                    myColor = (0,255,0)

                elif currentClass == 'NO-Hardhat' or currentClass == 'NO-Safety Vest' or currentClass == 'NO-Mask' or currentClass == 'NO-Gloves':
                    myColor = (0,0,255)

                else:
                    myColor = (255,0,0)

            cvzone.putTextRect(
                img,
                f'{classNames[cls]} {conf * 100:.1f}%',  # show confidence as %
                (max(0, x1), max(35, y1)),  # position
                scale=1.2,  # bigger text
                thickness=2,  # thicker font
                colorB=myColor,  # background color = class color
                colorT=(255, 255, 255),  # text color = white
                colorR=myColor,  # border color
                offset=10,  # more padding around text
                font=cv2.FONT_HERSHEY_SIMPLEX  # clean bold font
            )
            cv2.rectangle(img,(x1,y1),(x2,y2),myColor,3)






    #       print(x1, y1, x2, y2)

    cv2.imshow("Image", img)
    cv2.waitKey(1)