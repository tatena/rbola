# Open-source car recognition spike: Jordo23/vehicle-classifier
# (EfficientNet-B4 / timm checkpoint, MIT, VMMRdb 8949 classes)
# Usage: .venv/bin/python recognize_open.py
import glob
import os
import time

import torch
from huggingface_hub import hf_hub_download
from PIL import Image
from torchvision import transforms

CARD_ASSETS = "/Users/tatena/Desktop/nino/carspotting/card-assets"
CATCHES = "/Users/tatena/Desktop/nino/carspotting/rbola/web/public/catches"

files = [os.path.join(CARD_ASSETS, f) for f in ["zonda.jpg", "gt3.jpg", "gr86.jpg"]]
files += sorted(glob.glob(os.path.join(CATCHES, "*.jpg")))

print("downloading checkpoint (first run)...")
ckpt_path = hf_hub_download("Jordo23/vehicle-classifier", "vehicle_classifier.pth")
ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
print("checkpoint keys:", list(ckpt.keys()) if isinstance(ckpt, dict) else type(ckpt))

# checkpoint carries model state + class mapping; key names vary, so probe
state = None
classes = None
if isinstance(ckpt, dict):
    for k in ("model_state_dict", "state_dict", "model"):
        if k in ckpt:
            state = ckpt[k]
            break
    for k in ("class_mapping", "classes", "idx_to_class", "class_to_idx"):
        if k in ckpt:
            classes = ckpt[k]
            break
    if state is None and all(hasattr(v, "shape") for v in ckpt.values()):
        state = ckpt  # bare state_dict
assert state is not None, "could not find weights in checkpoint"

if isinstance(classes, dict) and classes and not isinstance(next(iter(classes)), int):
    # class_to_idx → invert
    classes = {v: k for k, v in classes.items()}

import timm

model = timm.create_model("efficientnet_b4", pretrained=False, num_classes=8949)
model.load_state_dict(state)
model.eval()

preprocess = transforms.Compose(
    [
        transforms.Resize((380, 380)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)

for f in files:
    try:
        img = Image.open(f).convert("RGB")
        start = time.time()
        with torch.no_grad():
            logits = model(preprocess(img).unsqueeze(0))
            probs = torch.softmax(logits, dim=1)[0]
        secs = time.time() - start
        top = torch.topk(probs, 3)
        names = [
            str(classes.get(i.item(), i.item())) if classes else str(i.item())
            for i in top.indices
        ]
        line = " | ".join(f"{n} ({p:.2f})" for n, p in zip(names, top.values))
        print(f"\n=== {os.path.basename(f)} ({secs:.1f}s)\n    {line}")
    except Exception as e:
        print(f"\n=== {os.path.basename(f)} FAILED: {e}")
