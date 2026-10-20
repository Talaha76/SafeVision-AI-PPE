from ultralytics import YOLO
import cv2

model = YOLO('../Yolo-Weights/yolov8l.pt')
results = model("Images/cars.jpg")            # no show=True
img = results[0].plot()                       # annotated image
cv2.imshow("YOLOv8", img)
cv2.waitKey(0)                                # blocks until key press
cv2.destroyAllWindows()
