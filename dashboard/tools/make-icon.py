#!/usr/bin/env python3
"""生成控制台图标：品牌绿底板 + 手绘白鲸。

纯几何生成（零依赖），输出干净矢量 SVG —— 不是位图描摹。
改配色/改鲸鱼形状都在本文件里改，然后跑：

    python3 tools/make-icon.py

会覆盖 public/favicon.svg。PNG 派生件（favicon-32.png / apple-touch-icon.png）
用 headless Chrome 从 SVG 渲染：

    CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$CHROME" --headless --no-proxy-server --hide-scrollbars \\
      --default-background-color=00000000 --window-size=32,32 \\
      --screenshot=public/favicon-32.png data:...   # 或见 README
"""
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, os.pardir, "public", "favicon.svg"))

# ── 底板：超椭圆 squircle（n=5 ≈ iOS 连续圆角），内缩 30/512 ──
CX = CY = 256.0
RX = RY = 226.0
NEXP = 5.0
SAMPLES = 32


def squircle(samples=SAMPLES, n=NEXP, rx=RX, ry=RY, cx=CX, cy=CY):
    pts = []
    for i in range(samples):
        t = 2 * math.pi * i / samples
        c, s = math.cos(t), math.sin(t)
        x = cx + rx * math.copysign(abs(c) ** (2.0 / n), c)
        y = cy + ry * math.copysign(abs(s) ** (2.0 / n), s)
        pts.append((x, y))
    return pts


def fmt(v, prec=2):
    s = ("%.*f" % (prec, v)).rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def to_path(pts, prec=2):
    """闭合点列 → 向心 Catmull-Rom（α=0.5）三次贝塞尔路径"""
    n = len(pts)

    def dist(a, b):
        return max(math.hypot(b[0] - a[0], b[1] - a[1]), 1e-9) ** 0.5

    out = ["M%s %s" % (fmt(pts[0][0], prec), fmt(pts[0][1], prec))]
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        d1, d2, d3 = dist(p0, p1), dist(p1, p2), dist(p2, p3)
        d1_2, d2_2, d3_2 = d1 * d1, d2 * d2, d3 * d3
        c1 = tuple(
            (d1_2 * p2[k] - d2_2 * p0[k] + (2 * d1_2 + 3 * d1 * d2 + d2_2) * p1[k])
            / (3 * d1 * (d1 + d2))
            for k in (0, 1)
        )
        c2 = tuple(
            (d3_2 * p1[k] - d2_2 * p3[k] + (2 * d3_2 + 3 * d3 * d2 + d2_2) * p2[k])
            / (3 * d3 * (d3 + d2))
            for k in (0, 1)
        )
        out.append(
            "C%s %s %s %s %s %s"
            % (
                fmt(c1[0], prec), fmt(c1[1], prec),
                fmt(c2[0], prec), fmt(c2[1], prec),
                fmt(p2[0], prec), fmt(p2[1], prec),
            )
        )
    out.append("Z")
    return "".join(out)


# ── 白鲸：手工贝塞尔轮廓（头朝右，尾鳍在左）────────────────────
# 上叶尖(120,208) / 尾柄顶(240,262) / 尾柄底(222,328) / 凹口(208,316) / 下叶尖(118,388)
WHALE = (
    "M120 208"
    "C170 206 212 222 240 262"      # 上尾叶外缘 → 尾柄顶（细腰）
    "C252 226 278 202 308 194"      # 背部抬升到驼峰
    "C360 188 406 212 432 256"      # 背部下落进入头部
    "C456 292 450 330 416 348"      # 吻部圆转
    "C386 364 358 372 324 368"      # 腹线（饱满）
    "C282 364 248 350 222 328"      # 腹线收回尾柄底
    "C188 364 148 392 118 388"      # 下尾叶外缘 → 下叶尖
    "C152 364 186 342 208 316"      # 下尾叶内缘 → 凹口
    "C192 282 168 234 120 208"      # 上尾叶内缘 → 回到起点
    "Z"
)

EYE = (384, 284, 14)
MOUTH = "M344 322C368 342 398 340 416 322"
SPOUT = [(342, 152, 14), (376, 114, 10), (402, 80, 7)]


def build():
    d = to_path(squircle())
    spout = "".join(
        '<circle cx="%d" cy="%d" r="%d"/>' % c for c in SPOUT
    )
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="iskill-headroom-workbuddy">
  <title>iskill-headroom-workbuddy</title>
  <defs>
    <!-- 底板：#10C8A1 主色，左上提亮 / 右下加深 -->
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2FE4BE"/>
      <stop offset="0.52" stop-color="#10C8A1"/>
      <stop offset="1" stop-color="#067A62"/>
    </linearGradient>
    <!-- 鲸身：纯净白，带极轻的冷色反光 -->
    <linearGradient id="whale" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#EAFCF8"/>
    </linearGradient>
    <clipPath id="tile">
      <path d="{d}"/>
    </clipPath>
  </defs>

  <!-- 底板 -->
  <path d="{d}" fill="url(#bg)"/>

  <!-- 白鲸（裁切在底板内，与传统 App 图标一致） -->
  <g clip-path="url(#tile)">
    <g fill="url(#whale)">
      <path d="{WHALE}"/>
      {spout}
    </g>
    <circle cx="{EYE[0]}" cy="{EYE[1]}" r="{EYE[2]}" fill="#0DAF8D"/>
    <path d="{MOUTH}" fill="none" stroke="#0DAF8D" stroke-width="12" stroke-linecap="round"/>
  </g>
</svg>
'''
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(svg)
    print("written:", OUT, os.path.getsize(OUT), "bytes")
    print("squircle path len:", len(d))


if __name__ == "__main__":
    build()
