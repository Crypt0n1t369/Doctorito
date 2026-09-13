from pathlib import Path
import re
import html
import math
from collections import OrderedDict

from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether, Flowable, CondPageBreak
)
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path('/Users/kristaps/Documents/New project')
SOURCE = ROOT / 'output/atbalsts-offline'
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
FONTS = Path('/Users/kristaps/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype')
for name, fn in [('Noto','NotoSans-Regular.ttf'),('Noto-Bold','NotoSans-Bold.ttf'),
                 ('Noto-Italic','NotoSans-Italic.ttf'),('Noto-BoldItalic','NotoSans-BoldItalic.ttf'),
                 ('Mono','DejaVuSansMono.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONTS / fn)))
pdfmetrics.registerFontFamily('Noto', normal='Noto', bold='Noto-Bold', italic='Noto-Italic', boldItalic='Noto-BoldItalic')

W, H = A4
M = 49
CW = W - 2*M
INK = colors.HexColor('#172834')
MUTED = colors.HexColor('#52616c')
ACCENT = colors.HexColor('#98243b')
PALE = colors.HexColor('#f3f5f6')
LINE = colors.HexColor('#dce2e6')
WHITE = colors.white
styles = {
    'body': ParagraphStyle('body', fontName='Noto', fontSize=9.2, leading=13.6, textColor=INK, spaceAfter=7.8, allowWidows=0, allowOrphans=0),
    'small': ParagraphStyle('small', fontName='Noto', fontSize=8, leading=11.5, textColor=MUTED, spaceAfter=6),
    'heading': ParagraphStyle('heading', fontName='Noto-Bold', fontSize=13.5, leading=18, textColor=ACCENT, spaceBefore=16, spaceAfter=8, keepWithNext=True),
    'title': ParagraphStyle('title', fontName='Noto-Bold', fontSize=32, leading=38, textColor=INK, spaceAfter=15),
    'subtitle': ParagraphStyle('subtitle', fontName='Noto', fontSize=14, leading=20, textColor=MUTED, spaceAfter=16),
    'lead': ParagraphStyle('lead', fontName='Noto', fontSize=12, leading=18, textColor=INK, spaceAfter=15),
    'table': ParagraphStyle('table', fontName='Noto', fontSize=8, leading=11.5, textColor=INK, allowWidows=0, allowOrphans=0),
    'tablehead': ParagraphStyle('tablehead', fontName='Noto-Bold', fontSize=8, leading=11, textColor=WHITE),
    'bullet': ParagraphStyle('bullet', fontName='Noto', fontSize=9.2, leading=13.6, textColor=INK, leftIndent=13, firstLineIndent=-10, spaceAfter=5.5, allowWidows=0, allowOrphans=0),
    'toc': ParagraphStyle('toc', fontName='Noto', fontSize=10, leading=15, textColor=INK, spaceAfter=8),
    'ref': ParagraphStyle('ref', fontName='Noto', fontSize=7.5, leading=10.5, textColor=INK, spaceAfter=5, splitLongWords=True),
}

def norm(s):
    return s.translate(str.maketrans({'–':'-', '—':'-', '‑':'-', '\u00a0':' ', '…':'...', '→':'->', '↔':'<->'}))

class Formatter:
    def __init__(self, numbered=True):
        self.references = OrderedDict()
        self.numbered = numbered
    def inline(self, raw, collect=True):
        raw=norm(raw)
        saved=[]
        def link(m):
            label,target=m.group(1),m.group(2)
            if target.startswith('<') and target.endswith('>'): target=target[1:-1]
            if target.startswith('http'):
                if target not in self.references: self.references[target]=len(self.references)+1
                number=self.references[target]
                fragment='<link href="'+html.escape(target,quote=True)+'" color="#98243b">'+html.escape(label)+'</link>'
                if collect and self.numbered: fragment += ' <super size="6">['+str(number)+']</super>'
            else:
                if '/src/' in target: label += ' ('+target.split('/src/',1)[1]+')'
                elif target.endswith('.py'): label += ' (local calculation file)'
                fragment=html.escape(label)
            saved.append(fragment)
            return 'ZZLINK'+str(len(saved)-1)+'ZZ'
        raw=re.sub(r'\[([^\]]+)\]\((<[^>]+>|[^)]+)\)',link,raw)
        raw=html.escape(raw)
        raw=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',raw)
        raw=re.sub(r'`([^`]+)`',r'<font name="Mono" size="8">\1</font>',raw)
        for i,item in enumerate(saved):raw=raw.replace('ZZLINK'+str(i)+'ZZ',item)
        return raw

class Architecture(Flowable):
    def __init__(self):
        super().__init__()
        self.width=CW
        self.height=420
    def draw(self):
        c=self.canv
        c.setFillColor(PALE)
        c.roundRect(0,0,CW,self.height,8,fill=1,stroke=0)
        def box(x,y,w,h,title,sub):
            c.setFillColor(WHITE);c.setStrokeColor(LINE)
            c.roundRect(x,y,w,h,5,fill=1,stroke=1)
            p=Paragraph(title,ParagraphStyle('diagtitle',fontName='Noto-Bold',fontSize=9,leading=12,textColor=INK))
            _,ph=p.wrap(w-20,h)
            p.drawOn(c,x+10,y+h-10-ph)
            p2=Paragraph(sub,ParagraphStyle('diagsub',fontName='Noto',fontSize=7.5,leading=10,textColor=MUTED))
            _,ph2=p2.wrap(w-20,h)
            p2.drawOn(c,x+10,y+8)
        def arrow(x1,y1,x2,y2,both=False):
            c.setStrokeColor(ACCENT);c.setFillColor(ACCENT);c.setLineWidth(1.3)
            c.line(x1,y1,x2,y2)
            ang=math.atan2(y2-y1,x2-x1)
            def head(x,y,a):
                p=c.beginPath();p.moveTo(x,y)
                p.lineTo(x-5*math.cos(a-.4),y-5*math.sin(a-.4))
                p.lineTo(x-5*math.cos(a+.4),y-5*math.sin(a+.4));p.close()
                c.drawPath(p,fill=1,stroke=0)
            head(x2,y2,ang)
            if both:head(x1,y1,ang+math.pi)
        half=(CW-50)/2
        box(16,338,CW-32,63,'Authorised publisher','Approve, version and sign the same compact bulletin for every transport')
        box(16,239,half,66,'Regional hub','Independent backhaul; LoRa to local gateways')
        box(34+half,239,half,66,'Optional radio broadcast','Audible data; separate radio receiver required')
        arrow(95,338,95,306)
        arrow(CW-95,338,CW-95,306)
        box(16,140,half,66,'Community gateway','Radio + durable storage + local Wi-Fi / BLE')
        box(34+half,140,half,66,'Phone A','Verify and show update on the preloaded map')
        arrow(95,239,95,207,True)
        arrow(CW-95,239,CW-95,207)
        arrow(17+half,174,33+half,174,True)
        box(16,29,half,70,'Phone B / nearby device','Receive missing updates; encrypt and queue a report')
        box(34+half,29,half,70,'Vehicle / phone C / server','Carry report to a working link; return signed receipt')
        arrow(CW-95,140,110,100,True)
        arrow(17+half,64,33+half,64,True)
        p=Paragraph('Forwarding depends on an available link or a later encounter.',styles['small'])
        p.wrap(CW-32,30);p.drawOn(c,16,7)

class Doc(BaseDocTemplate):
    def __init__(self,path,title,short,lang):
        super().__init__(str(path),pagesize=A4,leftMargin=M,rightMargin=M,topMargin=63,bottomMargin=49,
                         title=title,author='Atbalsts',subject='Offline communications architecture and pilot planning',
                         pageCompression=1,allowSplitting=1)
        self.short=short
        self.lang=lang
        self.sections=[]
        frame=Frame(M,49,CW,H-112,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
        self.addPageTemplates(PageTemplate(id='all',frames=frame,onPage=self.decorate))
    def decorate(self,c,d):
        c.saveState()
        if d.page==1:
            c.setFillColor(ACCENT);c.rect(0,H-11,W,11,fill=1,stroke=0)
        else:
            c.setFont('Noto-Bold',8);c.setFillColor(ACCENT);c.drawString(M,H-34,'ATBALSTS')
            c.setFont('Noto',7.5);c.setFillColor(MUTED);c.drawRightString(W-M,H-34,self.short)
            c.setStrokeColor(LINE);c.line(M,H-43,W-M,H-43)
        c.setStrokeColor(LINE);c.line(M,37,W-M,37)
        c.setFont('Noto',7.3);c.setFillColor(MUTED)
        c.drawString(M,23,'8 September 2026' if self.lang=='en' else '2026. gada 8. septembris')
        c.drawRightString(W-M,23,str(d.page))
        c.restoreState()
    def afterFlowable(self,f):
        if isinstance(f,Paragraph) and getattr(f,'section_key',None):
            self.canv.bookmarkPage(f.section_key)
            self.canv.addOutlineEntry(f.getPlainText(),f.section_key,0,False)
            self.sections.append((f.getPlainText(),self.page))

def para(text,fmt,sty='body'):return Paragraph(fmt.inline(text),styles[sty])

def parse_markdown(text,fmt,main):
    lines=text.splitlines()
    result=[]
    i=0
    while i<len(lines):
        s=lines[i].strip()
        if not s:
            i+=1;continue
        if s.startswith('# '):
            i+=1;continue
        if s.startswith('Architecture decision memo') or s.startswith('Sagatavots 2026.'):
            i+=1;continue
        if s.startswith('```mermaid'):
            while i<len(lines) and not (lines[i].strip()=='```'):i+=1
            i+=1
            result.append(KeepTogether([Architecture(),Spacer(1,12)]))
            continue
        h=re.fullmatch(r'\*\*(\d+)\. (.+)\*\*',s)
        if h:
            title=h.group(1)+'. '+h.group(2)
            p=para(title,fmt,'heading')
            p.section_key='section-'+h.group(1)
            result.extend([CondPageBreak(105),p])
            i+=1;continue
        if s.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                row=[x.strip() for x in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[:\- ]+',x) for x in row):rows.append(row)
                i+=1
            n=len(rows[0])
            if n==2:ratios=[.39,.61]
            elif n==3:
                ratios=[.29,.46,.25] if 'Threat' in rows[0][0] else [.32,.36,.32]
            elif n==5:ratios=[.16,.26,.18,.23,.17]
            else:ratios=[1/n]*n
            cells=[[Paragraph(fmt.inline(t),styles['tablehead'] if j==0 else styles['table']) for t in row] for j,row in enumerate(rows)]
            t=Table(cells,colWidths=[CW*v for v in ratios],repeatRows=1,hAlign='LEFT')
            t.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,0),INK),('VALIGN',(0,0),(-1,-1),'TOP'),
                ('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
                ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
                ('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,PALE]),
                ('LINEBELOW',(0,0),(-1,0),.7,INK),
                ('LINEBELOW',(0,1),(-1,-1),.3,LINE),
            ]))
            result.extend([t,Spacer(1,11)]);continue
        if s.startswith('- ') or re.match(r'^\d+\. ',s):
            bullet='• ' + s[2:] if s.startswith('- ') else s
            result.append(para(bullet,fmt,'bullet'));i+=1;continue
        parts=[s];i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].strip().startswith(('|','```','# ','- ')) and not re.match(r'^\d+\. ',lines[i].strip()):
            parts.append(lines[i].strip());i+=1
        block=' '.join(parts)
        if main and block.startswith('**Recommendation:'):
            result.append(para(block,fmt,'lead'))
        else:result.append(para(block,fmt))
    return result

def cover(fmt):
    return [
        Spacer(1,55),
        Paragraph('ATBALSTS / ARCHITECTURE DECISION MEMO',ParagraphStyle('eyebrow',fontName='Noto-Bold',fontSize=9,leading=13,textColor=ACCENT,spaceAfter=24)),
        Paragraph('Practical communications<br/>during a cellular outage',styles['title']),
        Paragraph('Offline maps, LoRa, nearby exchange<br/>and data carried in radio audio',styles['subtitle']),
        Spacer(1,22),
        Paragraph('A proposed architecture, security assessment and staged pilot for Latvia.',styles['lead']),
        Spacer(1,32),
        Table([[Paragraph('RECOMMENDED FOUNDATION',styles['tablehead'])],
               [Paragraph('A locally installed app, shared community gateways and regional distribution over several communication paths.',styles['lead'])]],
              colWidths=[CW],style=TableStyle([('BACKGROUND',(0,0),(-1,0),ACCENT),('BACKGROUND',(0,1),(-1,1),PALE),
              ('LEFTPADDING',(0,0),(-1,-1),17),('RIGHTPADDING',(0,0),(-1,-1),17),
              ('TOPPADDING',(0,0),(-1,-1),14),('BOTTOMPADDING',(0,0),(-1,-1),14)])),
        Spacer(1,33),
        Paragraph('8 September 2026',styles['small']),
        Paragraph('Research and design proposal. No Atbalsts radio, acoustic, range, battery or phone-background performance was measured in this review. Budgets and service targets are planning assumptions.',styles['small']),
        PageBreak()
    ]

def refs_story(fmt):
    story=[CondPageBreak(130),Paragraph('Source links',styles['heading']),
           Paragraph('Clickable references used in this document. The source memo records the code revisions reviewed. Local calculation and code-file labels refer to the original editable workspace materials.',styles['small'])]
    for url,idx in fmt.references.items():
        display='<font size="0.1"> </font>'.join(html.escape(chunk) for chunk in re.split(r'(?<=[/?&=_-])',url))
        p=Paragraph('<b>['+str(idx)+']</b> <link href="'+html.escape(url,quote=True)+'" color="#98243b">'+display+'</link>',styles['ref'])
        story.append(p)
    return story

def build():
    mainfile=SOURCE/'atbalsts-offline-architecture-2026-09-08.md'
    maintext=mainfile.read_text()
    fmt=Formatter()
    body=parse_markdown(maintext,fmt,True)
    headings=re.findall(r'^\*\*(\d+\. .+)\*\*$',maintext,re.M)
    toc=[Paragraph('Contents',styles['heading']),Spacer(1,8)]
    for heading in headings:
        number=heading.split('.')[0]
        toc.append(Paragraph('<link href="#section-'+number+'" color="#172834">'+html.escape(norm(heading))+'</link>',styles['toc']))
    toc.extend([Spacer(1,10),Paragraph('Select a section above to jump to it. Source links are retained inline and collected at the end.',styles['small']),PageBreak()])
    path=OUT/'Atbalsts-offline-architecture-2026-09-08.pdf'
    doc=Doc(path,'Atbalsts: practical communications during a cellular outage','Offline communications / architecture','en')
    doc.build(cover(fmt)+toc+body+refs_story(fmt))
    lvfmt=Formatter(numbered=False)
    lvbody=parse_markdown((SOURCE/'atbilde-idc-lv-2026-09-08.md').read_text(),lvfmt,False)
    lvpath=OUT/'Atbalsts-atbilde-IDC-LV-2026-09-08.pdf'
    lvdoc=Doc(lvpath,'Atbildes projekts Iekšlietu digitālajam centram','Atbildes projekts IDC','lv')
    lvintro=[
        Spacer(1,5),
        Paragraph('ATBALSTS / ATBILDES PROJEKTS',ParagraphStyle('lveyebrow',fontName='Noto-Bold',fontSize=9,leading=13,textColor=ACCENT,spaceAfter=13)),
        Paragraph('Iekšlietu digitālajam centram',ParagraphStyle('lvtitle',parent=styles['title'],fontSize=24,leading=31)),
        Paragraph('Bezsaistes un radio/P2P risinājuma precizējumi',styles['subtitle']),
        Paragraph('Sagatavots 2026. gada 8. septembrī. Pārskatāms melnraksts; nav nosūtīts.',styles['small']),
        Spacer(1,9),
    ]
    lvdoc.build(lvintro+lvbody)
    for p in [path,lvpath]:
        reader=PdfReader(p)
        print(p.name,'pages',len(reader.pages),'bytes',p.stat().st_size,'links',sum(len(page.get('/Annots',[])) for page in reader.pages))
    print('Main section pages:',doc.sections)

if __name__=='__main__':build()
