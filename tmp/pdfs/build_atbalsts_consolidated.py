from pathlib import Path
import re
import html
import json
from collections import OrderedDict
from reportlab.platypus import Paragraph, Spacer, PageBreak, Table, TableStyle, CondPageBreak
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader
import build_atbalsts_pdfs as base

ROOT = base.ROOT
SOURCE = base.SOURCE
OUT = base.OUT / 'Atbalsts-consolidated-architecture-RD-funding-network-2026-09-08.pdf'
QA = ROOT / 'tmp/pdfs/consolidated'
QA.mkdir(parents=True, exist_ok=True)

class MasterDoc(base.Doc):
    def __init__(self):
        super().__init__(OUT, 'Atbalsts: architecture, R&D, funding and partner plan',
                         'Architecture, R&D, funding and partner plan', 'en')
        self.index = OrderedDict()
    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and getattr(f, 'section_key', None):
            self.canv.bookmarkPage(f.section_key)
            self.canv.addOutlineEntry(f.getPlainText(), f.section_key,
                                     getattr(f, 'outline_level', 1), False)
            self.index[f.section_key] = {'title': f.getPlainText(), 'page': self.page}

def heading(title, key, level=0):
    p = Paragraph(html.escape(base.norm(title)), base.styles['heading'])
    p.section_key = key
    p.outline_level = level
    return p

def parse_part(text, fmt, key_prefix, label_prefix=''):
    blocks = base.parse_markdown(text, fmt, True)
    for i, f in enumerate(blocks):
        if isinstance(f, Paragraph) and getattr(f, 'section_key', None):
            number = f.section_key.rsplit('-', 1)[-1]
            p = Paragraph(label_prefix + f.text, f.style)
            p.section_key = key_prefix + '-' + number
            p.outline_level = 1
            blocks[i] = p
    return blocks

def cover():
    title = ParagraphStyle('mastertitle', parent=base.styles['title'], fontSize=30, leading=37)
    eyebrow = ParagraphStyle('mastereyebrow', parent=base.styles['small'], fontName='Noto-Bold', textColor=base.ACCENT)
    stat = ParagraphStyle('stat', parent=base.styles['lead'], fontName='Noto-Bold', fontSize=18, leading=23, spaceAfter=0)
    stats = Table([
        [Paragraph('10-12 weeks', stat), Paragraph('EUR 30,000', stat), Paragraph('EUR 5,000', stat)],
        [Paragraph('Proposed demonstrator', base.styles['small']), Paragraph('Planning cash budget', base.styles['small']), Paragraph('Initial allocation within total', base.styles['small'])]
    ], colWidths=[base.CW / 3] * 3, style=TableStyle([
        ('BACKGROUND', (0,0),(-1,-1),base.PALE), ('VALIGN',(0,0),(-1,-1),'TOP'),
        ('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),8),
        ('TOPPADDING',(0,0),(-1,0),15),('BOTTOMPADDING',(0,-1),(-1,-1),12)
    ]))
    return [Spacer(1,48), Paragraph('ATBALSTS / CONSOLIDATED WORKING PLAN', eyebrow),
            Spacer(1,23), Paragraph('From architecture<br/>to a tested pilot', title),
            Paragraph('R&D, funding, people and the next decisions', base.styles['subtitle']),
            Spacer(1,25), Paragraph('A practical plan for trusted civilian information during prolonged communications outages.', base.styles['lead']),
            Spacer(1,20), stats, Spacer(1,30),
            Paragraph('Combines the complete technical assessment, the Latvian IDC response draft and the partner network discussed with Kristaps.', base.styles['body']),
            Paragraph('Includes VUGD, Valsts krīzes centrs, IDC, senior engineers, RTU students, Make Riga, Startschool, JCI Latvia, Ukrainian community organisations, the Austin MBA connection, Andrejs, Inga Ulmane and a prospective radio lead whose name may be Dzintars.',base.styles['small']),
            Spacer(1,20), Paragraph('8 September 2026',base.styles['small']),
            Paragraph('Proposed roles and planning estimates. Contact details and access were supplied by Kristaps; commitments and institutional endorsements remain to be confirmed. No physical radio or phone tests were performed in this review.',base.styles['small']),PageBreak()]

def contents(previous, plantext):
    rows=[]
    tocstyle=ParagraphStyle('mastertoc', parent=base.styles['body'], fontSize=9, leading=13, spaceAfter=0)
    entries=[('plan','Delivery, funding and network plan')]
    for n,title in re.findall(r'^\*\*(\d+)\. (.+)\*\*$',plantext,re.M):
        entries.append(('plan-'+n, n+'. '+title))
    entries += [('appendix-a','Appendix A. Full technical architecture and security assessment'),
                ('appendix-b','Appendix B. Latvian IDC response draft'),
                ('sources','Source links')]
    for key,title in entries:
        page=str(previous.get(key,{}).get('page',''))
        label='<link href="#'+key+'" color="#172834">'+html.escape(base.norm(title))+'</link>'
        if key in ('plan','appendix-a','appendix-b','sources'):label='<b>'+label+'</b>'
        rows.append([Paragraph(label,tocstyle),Paragraph(page,tocstyle)])
    t=Table(rows,colWidths=[base.CW-30,30],hAlign='LEFT')
    t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),
                          ('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),5),
                          ('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,0),(-1,-1),.25,base.LINE)]))
    return [Paragraph('Contents',base.styles['heading']),Spacer(1,10),t,Spacer(1,20),
            Paragraph('Select a title to jump to that section. PDF bookmarks also list the 16 technical sections in Appendix A. All page numbers belong to this consolidated document.',base.styles['small']),
            Paragraph('The planning section is intended for project coordination. Individual relationships and proposed asks should be confirmed before adapting material for external circulation.',base.styles['small']),PageBreak()]

def source_links(fmt):
    story=[PageBreak(),heading('Source links','sources'),
           Paragraph('Technical sources accompany the original 8 September 2026 research. Funding and partner-service pages were checked during the subsequent planning discussion on the same date. Programme eligibility and deadlines should be rechecked before applying. Personal relationships are user-provided context, not independently verified affiliations or commitments.',base.styles['small']),
           Paragraph('Code labels identify the repository revision or local source file reviewed, not the revision currently deployed. Transfer times, radio airtime, idealised site counts, energy and budgets were checked using a local Python calculation script retained in the editable project materials. Those calculations use analytical assumptions and perform no radio or device test; the script is not a separate Drive upload.',base.styles['small'])]
    refstyle=ParagraphStyle('masterref',parent=base.styles['ref'],fontSize=7.2,leading=10,spaceAfter=3.8)
    for url,idx in fmt.references.items():
        display='<font size="0.1"> </font>'.join(html.escape(chunk) for chunk in re.split(r'(?<=[/?&=_-])',url))
        story.append(Paragraph('<b>['+str(idx)+']</b> <link href="'+html.escape(url,quote=True)+'" color="#98243b">'+display+'</link>',refstyle))
    return story

def build_pass(previous):
    plantext=(SOURCE/'atbalsts-consolidated-plan-2026-09-08.md').read_text()
    plantext=plantext.replace('Consolidated working plan · 8 September 2026','')
    technical=(SOURCE/'atbalsts-offline-architecture-2026-09-08.md').read_text()
    technical=re.sub(r'\*\*Calculation record\.\*\*.*','',technical)
    lv=(SOURCE/'atbilde-idc-lv-2026-09-08.md').read_text()
    fmt=base.Formatter()
    plan=parse_part(plantext,fmt,'plan')
    appendix=parse_part(technical,fmt,'technical','A')
    lvbody=base.parse_markdown(lv,fmt,False)
    story=cover()+contents(previous,plantext)
    story += [heading('Delivery, funding and network plan','plan')]+plan
    story += [PageBreak(),heading('Appendix A. Technical architecture and security','appendix-a'),
              Paragraph('Complete technical assessment from 8 September 2026. Findings are tied to the inspected code revisions; estimates and tests are identified as proposed. The later coordination plan adds the named network and a staged funding target.',base.styles['small'])]+appendix
    story += [PageBreak(),heading('Appendix B. Latvian IDC response draft','appendix-b'),
              Paragraph('Atbildes projekts Iekšlietu digitālajam centram',base.styles['subtitle']),
              Paragraph('Sagatavots 2026. gada 8. septembrī. Pārskatāms melnraksts; nav nosūtīts.',base.styles['small'])]+lvbody
    story += source_links(fmt)
    doc=MasterDoc()
    doc.build(story)
    return doc.index,fmt.references

if __name__=='__main__':
    index,refs=build_pass({})
    final,refs=build_pass(index)
    assert final==index, 'Contents pagination changed between passes'
    reader=PdfReader(OUT)
    (QA/'index.json').write_text(json.dumps(final,ensure_ascii=False,indent=2))
    print(json.dumps({'path':str(OUT),'pages':len(reader.pages),'bytes':OUT.stat().st_size,'source_count':len(refs),'sections':final},ensure_ascii=False,indent=2))
