from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

out = Path(__file__).parent / 'audit-evidence'
out.mkdir(exist_ok=True)
c = canvas.Canvas(str(out / 'mixed-layout.pdf'), pagesize=(800, 450))
c.setFillColor(HexColor('#153d4b'))
c.rect(0, 0, 800, 450, fill=1, stroke=0)
c.setFillColor(HexColor('#ffffff'))
c.setFont('Helvetica-Bold', 32)
c.drawString(50, 360, 'SYNTHETIC IMPORT TEST')
c.setFont('Helvetica', 20)
c.drawString(50, 280, 'Left column')
c.drawString(500, 280, 'Right column')
c.setFillColor(HexColor('#f4b942'))
c.rect(50, 60, 700, 130, fill=1, stroke=0)
c.showPage()
c.setFillColor(HexColor('#2563eb'))
c.rect(0, 0, 800, 450, fill=1, stroke=0)
c.setFillColor(HexColor('#f4b942'))
c.circle(400, 225, 110, fill=1, stroke=0)
c.showPage()
c.setFont('Helvetica', 28)
c.drawString(50, 350, 'Final source page')
c.showPage()
c.save()
c = canvas.Canvas(str(out / 'forty-one-pages.pdf'), pagesize=(800, 450))
for i in range(41):
    c.setFont('Helvetica', 20)
    c.drawString(50, 350, f'Synthetic page {i+1}')
    c.showPage()
c.save()
print('Created 2 synthetic PDFs: mixed-layout (3 pages), forty-one-pages (41 pages).')
