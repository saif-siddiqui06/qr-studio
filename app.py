"""QR Studio: generate and scan QR codes.

Generation happens server-side with the `qrcode` library (PNG or SVG).
Scanning happens entirely in the browser (see static/scripts.js), so images
and camera frames never leave the user's device.
"""
import io
import re

import qrcode
import qrcode.image.svg
from flask import Flask, render_template, request, send_file, jsonify

app = Flask(__name__)

MAX_DATA_LENGTH = 2000
HEX_COLOR = re.compile(r"^#?[0-9a-fA-F]{6}$")
ERROR_LEVELS = {
    "L": qrcode.constants.ERROR_CORRECT_L,  # ~7% recovery
    "M": qrcode.constants.ERROR_CORRECT_M,  # ~15%
    "Q": qrcode.constants.ERROR_CORRECT_Q,  # ~25%
    "H": qrcode.constants.ERROR_CORRECT_H,  # ~30%
}


def _color(value, default):
    """Return a safe '#rrggbb' colour, or the default if the input is invalid."""
    if value and HEX_COLOR.match(value):
        return value if value.startswith("#") else f"#{value}"
    return default


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/generate_qr", methods=["GET"])
def generate_qr():
    data = request.args.get("data", "")
    if not data:
        return jsonify(error="No data provided for QR code generation"), 400
    if len(data) > MAX_DATA_LENGTH:
        return jsonify(error=f"Data is too long (max {MAX_DATA_LENGTH} characters)"), 400

    fg = _color(request.args.get("fg"), "#000000")
    bg = _color(request.args.get("bg"), "#ffffff")
    level = ERROR_LEVELS.get(request.args.get("ecc", "M").upper(), qrcode.constants.ERROR_CORRECT_M)
    try:
        box_size = min(max(int(request.args.get("size", 10)), 4), 20)
    except ValueError:
        box_size = 10
    fmt = request.args.get("format", "png").lower()

    qr = qrcode.QRCode(version=None, error_correction=level, box_size=box_size, border=4)
    qr.add_data(data)
    qr.make(fit=True)

    buf = io.BytesIO()
    if fmt == "svg":
        img = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
        svg = img.to_string(encoding="unicode")
        # Apply colours: a background rect behind the path, and the path fill.
        svg = re.sub(r"(<svg[^>]*>)", rf'\1<rect width="100%" height="100%" fill="{bg}"/>', svg, count=1)
        svg = svg.replace("<path ", f'<path fill="{fg}" ', 1)
        buf.write(svg.encode("utf-8"))
        buf.seek(0)
        return send_file(buf, mimetype="image/svg+xml", as_attachment=False, download_name="qr-code.svg")

    img = qr.make_image(fill_color=fg, back_color=bg)
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png", as_attachment=False, download_name="qr-code.png")


@app.route("/health")
def health():
    return jsonify(status="ok")


if __name__ == "__main__":
    app.run(debug=True)
