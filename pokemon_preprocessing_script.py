import os
import json
import colorsys
from PIL import Image
import numpy as np

# 設定資料夾路徑與輸出檔名
IMAGE_DIR = "./Images & Descriptions of All 1025 Pokemon/images"  # 請確保此資料夾內包含 1.png ~ 1025.png
OUTPUT_JSON = "pokemon_data.json"

def classify_color(h, s, v):
    """
    根據 HSV (Hue 0-360, Saturation 0-1, Value 0-1) 將顏色歸類
    """
    if v < 0.15:
        return "Black"
    if s < 0.15 and v > 0.8:
        return "White"
    if s < 0.15:
        return "Gray"

    # 色相 Hue (0 ~ 360) 分類
    if h >= 345 or h < 15:
        return "Red"
    elif 15 <= h < 45:
        return "Orange"
    elif 45 <= h < 70:
        return "Yellow"
    elif 70 <= h < 165:
        return "Green"
    elif 165 <= h < 250:
        return "Blue"
    elif 250 <= h < 290:
        return "Purple"
    elif 290 <= h < 345:
        return "Pink"
    return "Unknown"

def process_image(file_path, pokemon_id):
    try:
        img = Image.open(file_path).convert("RGBA")
        arr = np.array(img)

        # 取出 Alpha 通道 (透明度)
        alpha = arr[:, :, 3]
        
        # 只保留非透明像素 (Alpha > 30)
        visible_pixels = arr[alpha > 30]

        if len(visible_pixels) == 0:
            print(f"Warning: Image #{pokemon_id} is transparent!")
            return None

        # 取出 RGB 平均值 (忽略 Alpha)
        rgb_pixels = visible_pixels[:, :3]
        avg_r = float(np.mean(rgb_pixels[:, 0]))
        avg_g = float(np.mean(rgb_pixels[:, 1]))
        avg_b = float(np.mean(rgb_pixels[:, 2]))

        # 歸一化 RGB (0-1) 以計算 HSV
        r_norm, g_norm, b_norm = avg_r / 255.0, avg_g / 255.0, avg_b / 255.0
        h, s, v = colorsys.rgb_to_hsv(r_norm, g_norm, b_norm)

        h_deg = round(h * 360, 2)  # 轉成 0-360 度
        s_pct = round(s, 3)
        v_pct = round(v, 3)

        color_group = classify_color(h_deg, s_pct, v_pct)

        return {
            "id": pokemon_id,
            "filename": f"{pokemon_id}.png",
            "rgb": [int(avg_r), int(avg_g), int(avg_b)],
            "hsv": [h_deg, s_pct, v_pct],
            "hue": h_deg,
            "sat": s_pct,
            "val": v_pct,
            "color_group": color_group
        }

    except Exception as e:
        print(f"Error processing #{pokemon_id}: {e}")
        return None

def main():
    print("開始處理 1025 隻寶可夢色彩數據...")
    pokemon_list = []

    # 檢查圖片目錄是否存在
    if not os.path.exists(IMAGE_DIR):
        print(f"錯誤：找不到目錄 '{IMAGE_DIR}'，請確認圖片資料夾路徑。")
        return

    # 遍歷 1 到 1025
    for p_id in range(1, 1026):
        img_path = os.path.join(IMAGE_DIR, f"{p_id}.png")
        if os.path.exists(img_path):
            data = process_image(img_path, p_id)
            if data:
                pokemon_list.append(data)
                if p_id % 100 == 0:
                    print(f"已完成 {p_id} / 1025...")
        else:
            print(f"跳過缺失檔案: {p_id}.png")

    # 寫入 JSON 檔案
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(pokemon_list, f, ensure_ascii=False, indent=2)

    print(f"\n成功！已處理 {len(pokemon_list)} 隻寶可夢，數據已儲存至 '{OUTPUT_JSON}'。")

if __name__ == "__main__":
    main()