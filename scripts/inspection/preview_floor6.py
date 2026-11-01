from pathlib import Path
import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.config import Configuration
from ezdxf.addons.drawing import layout
from ezdxf.addons.drawing.svg import SVGBackend

source = Path.home() / "RAMANUJAN_6TH/DXF/RAMANUJAN_6THFLOOR.dxf"
output = Path("inspection_navigation/floor6_preview.svg")
output.parent.mkdir(parents=True, exist_ok=True)

doc = ezdxf.readfile(source)
msp = doc.modelspace()

backend = SVGBackend()
frontend = Frontend(
    RenderContext(doc),
    backend,
    config=Configuration.defaults()
)

frontend.draw_layout(msp, finalize=True)

page = layout.Page(
    297, 210,
    layout.Units.mm,
    margins=layout.Margins.all(5)
)

svg = backend.get_string(page=page)
output.write_text(svg, encoding="utf-8")

print(f"Preview saved to: {output}")
