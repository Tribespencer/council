#!/usr/bin/env python3
"""Build the Council outputs from a session.json.

    python3 build.py session.json --outdir ./council-output/2026-10-23-raise-prices

Validates the session, recomputes the scorecard, confidence and verdict,
then writes:
    session.json   (enriched with computed fields)
    replay.html    (self-contained animated replay, avatars embedded)
    report.pdf     (needs reportlab; otherwise report.html is written instead)

Only the standard library is required for validation and the replay.
Pillow makes the embedded avatars smaller; reportlab makes the PDF.
"""
import argparse
import base64
import html
import io
import json
import math
import os
import re
import statistics
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
DIMS = ["upside", "survivability", "odds", "timing", "fit"]
DIM_LABELS = {"upside": "Upside", "survivability": "Survivability", "odds": "Odds", "timing": "Timing", "fit": "Fit"}
VOTES = {"GO", "NO-GO", "GO-IF"}
VERDICTS = {"GO", "NO-GO", "GO-IF", "SPLIT"}


# ----------------------------------------------------------------------------
# validation + computation
# ----------------------------------------------------------------------------

def validate(s):
    errs, warns = [], []
    cast = s.get("cast") or []
    ids = {c.get("id") for c in cast}
    if "chair" not in ids:
        errs.append("cast must include the chair (id 'chair')")
    panel = [c["id"] for c in cast if c.get("id") != "chair"]
    if len(panel) < 3:
        errs.append("need at least three panelists")
    for key in ("meta", "intake", "rounds", "scorecard", "decision"):
        if key not in s:
            errs.append(f"missing top-level '{key}'")
    if errs:
        return errs, warns
    for c in cast:
        for k in ("id", "name", "seat", "avatar"):
            if not c.get(k):
                errs.append(f"cast entry missing '{k}': {c}")
    rounds = s["rounds"]
    if len(rounds) != 3:
        warns.append(f"expected 3 rounds, found {len(rounds)}")
    for r in rounds:
        n = r.get("number")
        for t in r.get("turns", []):
            if t.get("speaker") not in ids:
                errs.append(f"round {n}: unknown speaker '{t.get('speaker')}'")
            if t.get("stance") not in ("for", "against", "conditional"):
                errs.append(f"round {n}: {t.get('speaker')} has invalid stance '{t.get('stance')}'")
            if n == 2 and not t.get("reply_to"):
                errs.append(f"round 2: {t.get('speaker')} must reply_to someone")
            if t.get("reply_to") and t["reply_to"] not in ids:
                errs.append(f"round {n}: {t.get('speaker')} replies to unknown '{t['reply_to']}'")
            words = len((t.get("text") or "").split())
            if words < 30:
                warns.append(f"round {n}: {t.get('speaker')} turn is short ({words} words)")
            if words > 190:
                warns.append(f"round {n}: {t.get('speaker')} turn is long ({words} words)")
        if r.get("red_team") and r["red_team"] not in ids:
            errs.append(f"round {n}: red_team '{r['red_team']}' is not in cast")
        spoke = {t.get("speaker") for t in r.get("turns", [])}
        for p in panel:
            if p not in spoke:
                warns.append(f"round {n}: {p} did not speak")
    scores = s["scorecard"].get("scores") or {}
    for p in panel:
        sc = scores.get(p)
        if not sc:
            errs.append(f"scorecard missing entry for {p}")
            continue
        for d in DIMS:
            v = sc.get(d)
            if not isinstance(v, (int, float)) or not 1 <= v <= 10:
                errs.append(f"scorecard {p}.{d} must be a number 1-10, got {v!r}")
        if sc.get("vote") not in VOTES:
            errs.append(f"scorecard {p}.vote must be GO, NO-GO or GO-IF, got {sc.get('vote')!r}")
        if sc.get("vote") == "GO-IF" and not sc.get("conditions"):
            errs.append(f"scorecard {p} voted GO-IF without conditions")
    d = s["decision"]
    if d.get("verdict") not in VERDICTS:
        errs.append(f"decision.verdict must be one of {sorted(VERDICTS)}")
    if d.get("verdict") == "GO-IF" and not d.get("conditions"):
        errs.append("a GO-IF verdict needs at least one condition")
    if d.get("verdict") == "SPLIT" and not d.get("split"):
        errs.append("a SPLIT verdict needs decision.split")
    if d.get("dissent") and d["dissent"].get("speaker") not in ids:
        errs.append(f"dissent.speaker '{d['dissent'].get('speaker')}' is not in cast")
    if not d.get("headline"):
        warns.append("decision.headline is empty")
    if len(d.get("kill_criteria") or []) < 2:
        warns.append("fewer than two kill criteria")
    for r in s.get("research") or []:
        for rb in r.get("requested_by") or []:
            if rb not in ids:
                errs.append(f"research {r.get('id')}: requested_by unknown '{rb}'")
    return errs, warns


def compute(s):
    """Fill averages, composites, votes, computed verdict and confidence. Returns list of warnings."""
    warns = []
    panel = [c["id"] for c in s["cast"] if c["id"] != "chair"]
    sc = s["scorecard"]
    scores = sc["scores"]
    sc["dimensions"] = DIMS
    comps = {p: round(sum(scores[p][d] for d in DIMS) / len(DIMS), 2) for p in panel}
    avgs = {d: round(sum(scores[p][d] for p in panel) / len(panel), 2) for d in DIMS}
    council = round(sum(comps.values()) / len(comps), 2)
    votes = {v: sum(1 for p in panel if scores[p]["vote"] == v) for v in ("GO", "NO-GO", "GO-IF")}
    n = len(panel)
    majority = n // 2 + 1

    # decision rule (references/scorecard.md)
    if votes["NO-GO"] >= majority:
        verdict = "NO-GO"
    elif votes["GO"] >= majority and council >= 6.5:
        verdict = "GO"
    elif votes["GO"] + votes["GO-IF"] >= majority:
        verdict = "GO-IF"
    else:
        verdict = "SPLIT"
    if verdict == "GO" and avgs["survivability"] < 4.0:
        verdict = "GO-IF"
        warns.append("ruin veto: average survivability below 4.0, GO downgraded to GO-IF")

    spread = statistics.pstdev(comps.values()) if len(comps) > 1 else 0.0
    if verdict == "GO":
        share = votes["GO"] / n
    elif verdict == "NO-GO":
        share = votes["NO-GO"] / n
    elif verdict == "GO-IF":
        share = (votes["GO"] + votes["GO-IF"]) / n
    else:
        share = max(votes.values()) / n
    confidence = int(round(100 * share * max(0.0, 1 - spread / 5)))

    sc["composites"] = comps
    sc["averages"] = avgs
    sc["council_composite"] = council
    sc["votes"] = votes
    sc["spread"] = round(spread, 2)
    d = s["decision"]
    declared = d.get("verdict")
    if declared != verdict:
        warns.append(f"declared verdict {declared} does not match the decision rule ({verdict}); using {verdict}")
        d["verdict_declared"] = declared
        d["verdict"] = verdict
    if d.get("confidence") not in (None, confidence):
        warns.append(f"declared confidence {d.get('confidence')} replaced by computed {confidence}")
    d["confidence"] = confidence
    if verdict == "GO-IF" and not d.get("conditions"):
        conds = []
        for p in panel:
            for c in scores[p].get("conditions") or []:
                if c not in conds:
                    conds.append(c)
        d["conditions"] = conds
        warns.append("GO-IF conditions were empty; filled from panelist conditions")
    return warns


# ----------------------------------------------------------------------------
# avatars
# ----------------------------------------------------------------------------

def avatar_path(assets, filename):
    p = os.path.join(assets, "avatars", filename)
    if os.path.exists(p):
        return p
    return os.path.join(assets, "avatars", "wildcard.png")


def avatar_data_uri(path, size=320):
    data = None
    try:
        from PIL import Image
        im = Image.open(path).convert("RGBA")
        im.thumbnail((size, size))
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
    except Exception:
        with open(path, "rb") as f:
            data = f.read()
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


# ----------------------------------------------------------------------------
# replay.html
# ----------------------------------------------------------------------------

def build_replay(s, assets, template_path, out):
    with open(template_path, encoding="utf-8") as f:
        tpl = f.read()
    avatars = {}
    for c in s["cast"]:
        avatars[c["id"]] = avatar_data_uri(avatar_path(assets, c["avatar"]))
    a = s["meta"].get("attribution") or {}
    def js(o):
        return json.dumps(o, ensure_ascii=False).replace("</", "<\\/")
    page = (tpl.replace("__SESSION_JSON__", js(s))
               .replace("__AVATARS_JSON__", js(avatars))
               .replace("__TITLE__", html.escape(s["meta"].get("title", "Council")))
               .replace("__TAGLINE__", html.escape(a.get("tagline", "")))
               .replace("__PRODUCT__", html.escape(a.get("product", "Council")))
               .replace("__NAME__", html.escape(a.get("name", "")))
               .replace("__HANDLE__", html.escape(a.get("handle", "")))
               .replace("__URL__", html.escape(a.get("url", ""))))
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)


# ----------------------------------------------------------------------------
# report.pdf
# ----------------------------------------------------------------------------

def md_inline(text):
    """Escape for reportlab Paragraph and convert **bold**."""
    t = html.escape(str(text or ""), quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    return t.replace("\n\n", "<br/><br/>").replace("\n", "<br/>")


def build_pdf(s, assets, out):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether, NextPageTemplate,
                                    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle)

    NAVY = colors.HexColor("#0b1020")
    NAVY2 = colors.HexColor("#161f38")
    AMBER = colors.HexColor("#c8901d")
    AMBER_L = colors.HexColor("#f5b942")
    CREAM = colors.HexColor("#f3ead7")
    MUTED = colors.HexColor("#6b7390")
    LINE = colors.HexColor("#d9d3c4")
    FOR = colors.HexColor("#1f9d5a")
    AGAINST = colors.HexColor("#d63d4d")
    COND = colors.HexColor("#c8901d")
    STANCE = {"for": FOR, "against": AGAINST, "conditional": COND}
    VCOL = {"GO": FOR, "NO-GO": AGAINST, "GO-IF": COND, "SPLIT": colors.HexColor("#4f7bd9")}

    W, H = letter
    cast = {c["id"]: c for c in s["cast"]}
    panel = [c for c in s["cast"] if c["id"] != "chair"]
    meta, d, sc = s["meta"], s["decision"], s["scorecard"]
    attr = meta.get("attribution") or {}
    last = lambda cid: cast[cid]["name"].split()[-1] if cid in cast and cid != "chair" else "The Chair"

    st = {
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=NAVY, spaceAfter=10),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=AMBER, spaceBefore=12, spaceAfter=6),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=14.5, textColor=NAVY),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=MUTED),
        "quote": ParagraphStyle("quote", fontName="Times-Italic", fontSize=11, leading=15, textColor=AMBER, leftIndent=8, borderPadding=0),
        "name": ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=NAVY),
        "seat": ParagraphStyle("seat", fontName="Helvetica", fontSize=8, leading=10, textColor=MUTED),
        "headline": ParagraphStyle("headline", fontName="Times-Bold", fontSize=18, leading=22, textColor=NAVY, spaceAfter=8),
        "chair": ParagraphStyle("chair", fontName="Helvetica-Oblique", fontSize=9.5, leading=13.5, textColor=colors.HexColor("#3b4a7a")),
        "li": ParagraphStyle("li", fontName="Helvetica", fontSize=10, leading=14, textColor=NAVY, leftIndent=14, bulletIndent=2),
    }
    # letterspaced section label via explicit spaces
    def h2(text):
        return Paragraph("&nbsp;&nbsp;&nbsp;".join(" ".join(w) for w in text.upper().split()), st["h2"])

    small_cache = {}
    def small_avatar_path(cid):
        src = avatar_path(assets, cast[cid]["avatar"])
        if src in small_cache:
            return small_cache[src]
        try:
            from PIL import Image as PILImage
            import tempfile
            im = PILImage.open(src).convert("RGBA")
            im.thumbnail((200, 200))
            fd, tmp = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            im.save(tmp, format="PNG", optimize=True)
            small_cache[src] = tmp
        except Exception:
            small_cache[src] = src
        return small_cache[src]

    def avatar(cid, size):
        return Image(small_avatar_path(cid), width=size, height=size)

    # ---- page callbacks
    def cover_page(cv, doc):
        cv.saveState()
        cv.setFillColor(NAVY); cv.rect(0, 0, W, H, stroke=0, fill=1)
        cv.setFillColor(AMBER_L); cv.setFont("Helvetica-Bold", 13)
        cv.drawString(0.9 * inch, H - 0.9 * inch, "C O U N C I L")
        cv.setFillColor(MUTED); cv.setFont("Helvetica", 8.5)
        cv.drawString(0.9 * inch, H - 1.08 * inch, attr.get("tagline", ""))
        cv.drawRightString(W - 0.9 * inch, H - 0.9 * inch, meta.get("date", ""))
        # question
        cv.setFillColor(CREAM)
        from reportlab.platypus import Paragraph as P
        qstyle = ParagraphStyle("q", fontName="Times-Bold", fontSize=30, leading=35, textColor=CREAM)
        p = P(html.escape(meta.get("title", "")), qstyle)
        w, h = p.wrap(W - 1.8 * inch, 3 * inch)
        p.drawOn(cv, 0.9 * inch, H - 1.6 * inch - h)
        y = H - 1.8 * inch - h
        qs = ParagraphStyle("qs", fontName="Helvetica", fontSize=10.5, leading=14, textColor=colors.HexColor("#b8c0dc"))
        p2 = P(html.escape(meta.get("question", "")), qs)
        w2, h2_ = p2.wrap(W - 1.8 * inch, 2 * inch)
        p2.drawOn(cv, 0.9 * inch, y - h2_)
        y = y - h2_ - 0.55 * inch
        # verdict stamp
        v = d.get("verdict", "")
        cv.setFillColor(MUTED); cv.setFont("Helvetica-Bold", 8.5)
        cv.drawString(0.9 * inch, y, "T H E   C O U N C I L   H A S   D E C I D E D")
        cv.setFillColor(VCOL.get(v, AMBER_L)); cv.setFont("Times-Bold", 64)
        cv.drawString(0.85 * inch, y - 0.78 * inch, v)
        cv.setFillColor(colors.HexColor("#b8c0dc")); cv.setFont("Helvetica", 10)
        cv.drawString(0.9 * inch, y - 1.02 * inch, f"confidence {d.get('confidence', '-')} / 100   ·   {len(panel)} panelists   ·   3 rounds" + ("   ·   researched" if meta.get("research") else ""))
        hs = ParagraphStyle("hs", fontName="Times-Italic", fontSize=15, leading=19, textColor=AMBER_L)
        p3 = P(html.escape(d.get("headline", "")), hs)
        w3, h3 = p3.wrap(W - 1.8 * inch, 1.5 * inch)
        p3.drawOn(cv, 0.9 * inch, y - 1.25 * inch - h3)
        # cast row with vote badges
        size = 0.95 * inch
        gap = (W - 1.8 * inch - size * len(s["cast"])) / max(1, len(s["cast"]) - 1)
        x = 0.9 * inch
        yrow = max(2.3 * inch, y - 1.25 * inch - h3 - 0.75 * inch - size)
        cv.setFillColor(MUTED); cv.setFont("Helvetica-Bold", 8.5)
        cv.drawString(0.9 * inch, yrow + size + 0.22 * inch, "T H E   P A N E L")
        for c in s["cast"]:
            try:
                cv.drawImage(avatar_path(assets, c["avatar"]), x, yrow, size, size, mask="auto")
            except Exception:
                pass
            cv.setFillColor(CREAM); cv.setFont("Helvetica-Bold", 7.5)
            cv.drawCentredString(x + size / 2, yrow - 0.14 * inch, c["name"] if c["id"] == "chair" else c["name"].split()[-1])
            cv.setFillColor(MUTED); cv.setFont("Helvetica", 6.5)
            cv.drawCentredString(x + size / 2, yrow - 0.26 * inch, c["seat"])
            vote = (sc.get("scores", {}).get(c["id"]) or {}).get("vote")
            if vote:
                cv.setFillColor(VCOL.get(vote, AMBER_L)); cv.setFont("Helvetica-Bold", 7.5)
                tw = cv.stringWidth(vote, "Helvetica-Bold", 7.5)
                cv.roundRect(x + size / 2 - tw / 2 - 5, yrow - 0.48 * inch, tw + 10, 0.16 * inch, 3, stroke=0, fill=1)
                cv.setFillColor(NAVY)
                cv.drawCentredString(x + size / 2, yrow - 0.445 * inch, vote)
            x += size + gap
        if d.get("dissent") and d["dissent"].get("speaker") in cast:
            ds = d["dissent"]
            one = (sc.get("scores", {}).get(ds["speaker"]) or {}).get("one_line") or ""
            cv.setFillColor(MUTED); cv.setFont("Helvetica", 8.5)
            cv.drawString(0.9 * inch, yrow - 0.85 * inch, f"Dissent: {cast[ds['speaker']]['name']}" + (f"  ·  “{one}”" if one else ""))
        cv.setStrokeColor(colors.HexColor("#243055")); cv.line(0.9 * inch, 0.95 * inch, W - 0.9 * inch, 0.95 * inch)
        cv.setFillColor(MUTED); cv.setFont("Helvetica", 7.5)
        cv.drawString(0.9 * inch, 0.72 * inch, f"{attr.get('product', 'Council')} by {attr.get('name', '')}  ·  {attr.get('handle', '')}  ·  {attr.get('url', '')}")
        cv.drawString(0.9 * inch, 0.58 * inch, "AI personas inspired by public work. Not the real people. Not advice.")
        cv.restoreState()

    def later_page(cv, doc):
        cv.saveState()
        cv.setStrokeColor(LINE); cv.line(0.9 * inch, 0.75 * inch, W - 0.9 * inch, 0.75 * inch)
        cv.setFillColor(MUTED); cv.setFont("Helvetica", 7.5)
        cv.drawString(0.9 * inch, 0.55 * inch, f"{attr.get('product', 'Council')}  ·  {meta.get('title', '')}")
        cv.drawRightString(W - 0.9 * inch, 0.55 * inch, f"{attr.get('handle', '')}  ·  {attr.get('url', '')}  ·  {doc.page}")
        cv.restoreState()

    doc = BaseDocTemplate(out, pagesize=letter, leftMargin=0.9 * inch, rightMargin=0.9 * inch, topMargin=0.9 * inch, bottomMargin=1.0 * inch,
                          title=meta.get("title", "Council"), author=attr.get("product", "Council"))
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="cover", frames=[frame], onPage=cover_page),
                          PageTemplate(id="later", frames=[frame], onPage=later_page)])
    E = [NextPageTemplate("later"), PageBreak()]

    # ---- decision page
    E.append(Paragraph("The decision", st["h1"]))
    E.append(Paragraph(md_inline(d.get("headline", "")), st["headline"]))
    E.append(Paragraph(md_inline(d.get("summary", "")), st["body"]))
    if d.get("split"):
        sp = d["split"]
        E.append(h2("The split"))
        for camp in ("camp_a", "camp_b"):
            c = sp.get(camp) or {}
            E.append(Paragraph(f"<b>{', '.join(last(m) for m in c.get('members', []))}:</b> {md_inline(c.get('position', ''))}", st["body"]))
            E.append(Spacer(1, 4))
        E.append(Paragraph(f"<b>Experiment to settle it:</b> {md_inline(sp.get('experiment', ''))}", st["body"]))
    if d.get("conditions"):
        E.append(h2("Conditions"))
        for i, c in enumerate(d["conditions"], 1):
            E.append(Paragraph(md_inline(c), st["li"], bulletText=f"{i}."))
    if d.get("actions"):
        E.append(h2("Do this"))
        rows = [[Paragraph(f"<b>{i}.</b>", st["body"]), Paragraph(md_inline(a.get("text", "")), st["body"]), Paragraph(md_inline(a.get("when", "")), st["small"])]
                for i, a in enumerate(d["actions"], 1)]
        t = Table(rows, colWidths=[0.3 * inch, doc.width - 1.6 * inch, 1.3 * inch])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 6)]))
        E.append(t)
    if d.get("kill_criteria"):
        E.append(h2("Kill criteria: reverse this if"))
        for c in d["kill_criteria"]:
            E.append(Paragraph(md_inline(c), st["li"], bulletText="•"))
    if d.get("dissent") and d["dissent"].get("speaker") in cast:
        ds = d["dissent"]
        dissent_label = h2("The dissent")
        box = Table([[avatar(ds["speaker"], 0.8 * inch),
                      [Paragraph("“" + md_inline(ds.get("text", "")) + "”", st["quote"]),
                       Spacer(1, 4), Paragraph(f"{cast[ds['speaker']]['name']} · {cast[ds['speaker']]['seat']}", st["seat"])]]],
                    colWidths=[1.0 * inch, doc.width - 1.0 * inch])
        box.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fbf7ee")),
                                 ("BOX", (0, 0), (-1, -1), 0.6, AMBER), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
        E.append(KeepTogether([dissent_label, box]))

    # ---- scorecard
    E.append(CondPageBreak(5.5 * inch))
    E.append(Spacer(1, 14))
    E.append(Paragraph("Scorecard", st["h1"]))
    head = [""] + [DIM_LABELS[x] for x in DIMS] + ["Vote"]
    rows = [head]
    for p in panel:
        scp = sc["scores"][p["id"]]
        rows.append([Paragraph(f"<b>{p['name']}</b><br/><font size=7 color='#6b7390'>{p['seat']}</font>", st["body"])] + [str(scp[x]) for x in DIMS] + [scp["vote"]])
    rows.append(["Council"] + [f"{sc['averages'][x]:.1f}" for x in DIMS] + [""])
    t = Table(rows, colWidths=[2.0 * inch] + [0.8 * inch] * 5 + [0.75 * inch])
    ts = [("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 7.5), ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
          ("ALIGN", (1, 0), (-1, -1), "CENTER"), ("FONTNAME", (1, 1), (-2, -1), "Helvetica"), ("FONTSIZE", (1, 1), (-1, -1), 10),
          ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
          ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("TEXTCOLOR", (0, -1), (-1, -1), AMBER), ("LINEABOVE", (0, -1), (-1, -1), 1.2, AMBER),
          ("FONTNAME", (-1, 1), (-1, -1), "Helvetica-Bold"), ("FONTSIZE", (-1, 1), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]
    for i, p in enumerate(panel, 1):
        ts.append(("TEXTCOLOR", (-1, i), (-1, i), VCOL.get(sc["scores"][p["id"]]["vote"], NAVY)))
    t.setStyle(TableStyle(ts))
    E.append(t)
    E.append(Spacer(1, 8))
    E.append(Paragraph(f"Council composite <b>{sc['council_composite']:.1f}</b> / 10 · votes: GO {sc['votes']['GO']}, GO-IF {sc['votes']['GO-IF']}, NO-GO {sc['votes']['NO-GO']} · spread {sc['spread']} · confidence <b>{d['confidence']}</b>", st["small"]))
    E.append(h2("One line each"))
    for p in panel:
        ol = sc["scores"][p["id"]].get("one_line")
        if ol:
            E.append(Paragraph(f"<b>{p['name'].split()[-1]}:</b> {md_inline(ol)}", st["li"], bulletText="›"))
    E.append(h2("How to read this"))
    E.append(Paragraph("Each panelist scores five dimensions from 1 to 10, where 10 is always better for doing the thing. GO needs a majority of GO votes and a council composite of at least 6.5. NO-GO needs a majority of NO-GO votes. GO-IF is a majority for doing it with conditions attached. SPLIT means no majority, and the council owes you an experiment instead of a verdict. If average survivability falls below 4, a GO is downgraded to GO-IF. Confidence combines how many voted with the verdict and how far apart their scores were.", st["small"]))

    # ---- brief
    E.append(h2("The brief"))
    E.append(Paragraph(f"<b>You asked:</b> “{md_inline(s['intake'].get('one_liner', ''))}”", st["body"]))
    E.append(Spacer(1, 6))
    E.append(Paragraph(md_inline(s["intake"].get("brief", "")), st["body"]))
    if s["intake"].get("clarifications"):
        E.append(Spacer(1, 6))
        for qa in s["intake"]["clarifications"]:
            E.append(Paragraph(f"<b>Q:</b> {md_inline(qa.get('q', ''))}<br/><b>A:</b> {md_inline(qa.get('a', ''))}", st["small"]))
            E.append(Spacer(1, 3))

    # ---- rounds
    for r in s["rounds"]:
        E.append(CondPageBreak(4 * inch))
        E.append(Spacer(1, 14))
        E.append(Paragraph(f"Round {r['number']}: {r.get('title', '')}", st["h1"]))
        if r.get("chair_intro"):
            E.append(Paragraph(md_inline(r["chair_intro"]) + (f" <b>Red Team: {last(r['red_team'])}.</b>" if r.get("red_team") else ""), st["chair"]))
            E.append(Spacer(1, 8))
        for t in r.get("turns", []):
            cid = t["speaker"]
            if cid not in cast:
                continue
            tags = f"<font color='{STANCE.get(t.get('stance'), COND).hexval()}'><b>{t.get('stance', '').upper()}</b></font>"
            if t.get("reply_to") in cast:
                tags += f"  <font color='#6b7390'>answers {last(t['reply_to'])}</font>"
            if r.get("red_team") == cid and r["number"] == 2:
                tags += "  <font color='#d63d4d'>RED TEAM</font>"
            right = [Paragraph(f"{cast[cid]['name']}  <font size=7.5>{tags}</font>", st["name"]),
                     Paragraph(cast[cid]["seat"], st["seat"]), Spacer(1, 3),
                     Paragraph(md_inline(t.get("text", "")), st["body"])]
            if t.get("pull_quote"):
                right += [Spacer(1, 3), Paragraph("“" + md_inline(t["pull_quote"]) + "”", st["quote"])]
            row = Table([[avatar(cid, 0.62 * inch), right]], colWidths=[0.8 * inch, doc.width - 0.8 * inch])
            row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("BOTTOMPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (0, 0), 0)]))
            E.append(KeepTogether(row))
        if r.get("chair_summary"):
            E.append(Spacer(1, 6))
            E.append(KeepTogether([Paragraph("<b>The Chair:</b> " + md_inline(r["chair_summary"]), st["chair"])]))

    # ---- sources
    if s.get("research"):
        E.append(CondPageBreak(3.5 * inch))
        E.append(Spacer(1, 14))
        E.append(Paragraph("Research desk", st["h1"]))
        E.append(Paragraph("Facts the panel asked for between rounds one and two, with where they came from.", st["small"]))
        E.append(Spacer(1, 6))
        for i, rr in enumerate(s["research"], 1):
            who = ", ".join(last(x) for x in rr.get("requested_by", []) if x in cast)
            E.append(Paragraph(f"<b>{md_inline(rr.get('claim', ''))}</b><br/><font color='#6b7390'>{md_inline(rr.get('source', ''))}" + (f" · {md_inline(rr['url'])}" if rr.get("url") else "") + (f" · asked by {who}" if who else "") + "</font>", st["li"], bulletText=f"{i}."))
            E.append(Spacer(1, 4))

    # ---- about
    E.append(Spacer(1, 18))
    E.append(h2("About this report"))
    E.append(Paragraph(md_inline(attr.get("disclaimer", "")), st["small"]))
    E.append(Spacer(1, 4))
    E.append(Paragraph(f"Generated by {attr.get('product', 'Council')}, a free skill by {attr.get('name', '')} ({attr.get('handle', '')}). Get it at {attr.get('url', '')}. Mode: {meta.get('mode', '')} on {meta.get('platform', '')}.", st["small"]))

    doc.build(E)


# ----------------------------------------------------------------------------
# report.html fallback (no reportlab)
# ----------------------------------------------------------------------------

def build_report_html(s, assets, out):
    cast = {c["id"]: c for c in s["cast"]}
    panel = [c for c in s["cast"] if c["id"] != "chair"]
    meta, d, sc = s["meta"], s["decision"], s["scorecard"]
    attr = meta.get("attribution") or {}
    av = {c["id"]: avatar_data_uri(avatar_path(assets, c["avatar"]), 160) for c in s["cast"]}
    e = html.escape
    def md(t):
        return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", e(str(t or ""))).replace("\n\n", "<br><br>")
    parts = [f"""<!doctype html><html><head><meta charset="utf-8"><title>{e(meta.get('title',''))} · Council</title>
<style>body{{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0b1020;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.5}}
.cover{{background:#0b1020;color:#f3ead7;padding:40px;border-radius:16px}} .cover h1{{font-family:Georgia,serif;font-size:34px;margin:10px 0}}
.verdict{{font-family:Georgia,serif;font-size:56px;font-weight:bold;color:#f5b942;margin:16px 0 4px}} h2{{color:#c8901d;font-size:12px;letter-spacing:.2em;text-transform:uppercase;margin-top:32px}}
.turn{{display:flex;gap:14px;border-bottom:1px solid #e4dfd2;padding:12px 0}} .turn img{{width:56px;height:56px;border-radius:50%}} .pq{{font-family:Georgia,serif;font-style:italic;color:#c8901d;border-left:3px solid #c8901d;padding-left:10px;margin-top:6px}}
table{{border-collapse:collapse;width:100%}} td,th{{padding:8px;border-bottom:1px solid #e4dfd2;text-align:center}} td:first-child{{text-align:left}} .avg{{font-weight:bold;color:#c8901d}}
.cast img{{width:72px;height:72px;border-radius:50%;margin-right:8px}} .small{{color:#6b7390;font-size:13px}} @media print{{.cover{{-webkit-print-color-adjust:exact}}}}</style></head><body>
<div class="cover"><div style="letter-spacing:.3em;color:#f5b942;font-weight:bold">COUNCIL</div><h1>{e(meta.get('title',''))}</h1><div class="small">{e(meta.get('question',''))}</div>
<div class="verdict">{e(d.get('verdict',''))}</div><div class="small">confidence {d.get('confidence','-')} / 100 · {meta.get('date','')}</div><p style="font-family:Georgia,serif;font-style:italic;font-size:18px;color:#f5b942">{e(d.get('headline',''))}</p>
<div class="cast">{''.join(f'<img src="{av[c["id"]]}" title="{e(c["name"])}">' for c in s['cast'])}</div></div>
<h2>The decision</h2><p>{md(d.get('summary',''))}</p>"""]
    if d.get("conditions"):
        parts.append("<h2>Conditions</h2><ol>" + "".join(f"<li>{md(c)}</li>" for c in d["conditions"]) + "</ol>")
    if d.get("actions"):
        parts.append("<h2>Do this</h2><ol>" + "".join(f"<li>{md(a.get('text',''))} <span class='small'>{e(a.get('when',''))}</span></li>" for a in d["actions"]) + "</ol>")
    if d.get("kill_criteria"):
        parts.append("<h2>Kill criteria</h2><ul>" + "".join(f"<li>{md(c)}</li>" for c in d["kill_criteria"]) + "</ul>")
    if d.get("dissent") and d["dissent"].get("speaker") in cast:
        ds = d["dissent"]
        parts.append(f"<h2>The dissent</h2><div class='turn'><img src='{av[ds['speaker']]}'><div><div class='pq'>“{md(ds.get('text',''))}”</div><div class='small'>{e(cast[ds['speaker']]['name'])}</div></div></div>")
    parts.append("<h2>Scorecard</h2><table><tr><th></th>" + "".join(f"<th>{DIM_LABELS[x]}</th>" for x in DIMS) + "<th>Vote</th></tr>")
    for p in panel:
        scp = sc["scores"][p["id"]]
        parts.append(f"<tr><td>{e(p['name'])}</td>" + "".join(f"<td>{scp[x]}</td>" for x in DIMS) + f"<td><b>{e(scp['vote'])}</b></td></tr>")
    parts.append("<tr class='avg'><td>Council</td>" + "".join(f"<td>{sc['averages'][x]:.1f}</td>" for x in DIMS) + "<td></td></tr></table>")
    parts.append(f"<h2>The brief</h2><p><b>You asked:</b> “{e(s['intake'].get('one_liner',''))}”</p><p>{md(s['intake'].get('brief',''))}</p>")
    for r in s["rounds"]:
        parts.append(f"<h2>Round {r['number']}: {e(r.get('title',''))}</h2><p class='small'>{e(r.get('chair_intro',''))}</p>")
        for t in r.get("turns", []):
            if t["speaker"] not in cast:
                continue
            c = cast[t["speaker"]]
            parts.append(f"<div class='turn'><img src='{av[c['id']]}'><div><b>{e(c['name'])}</b> <span class='small'>{e(c['seat'])} · {e(t.get('stance',''))}" + (f" · ↩ {e(cast[t['reply_to']]['name'])}" if t.get('reply_to') in cast else "") + f"</span><p>{md(t.get('text',''))}</p>" + (f"<div class='pq'>“{md(t['pull_quote'])}”</div>" if t.get('pull_quote') else "") + "</div></div>")
        if r.get("chair_summary"):
            parts.append(f"<p class='small'><b>The Chair:</b> {md(r['chair_summary'])}</p>")
    if s.get("research"):
        def link(x):
            return ("· <a href='" + e(x["url"]) + "'>" + e(x["url"]) + "</a>") if x.get("url") else ""
        parts.append("<h2>Research desk</h2><ol>" + "".join(f"<li>{md(x.get('claim',''))} <span class='small'>{e(x.get('source',''))} {link(x)}</span></li>" for x in s["research"]) + "</ol>")
    parts.append(f"<h2>About</h2><p class='small'>{e(attr.get('disclaimer',''))}</p><p class='small'>{e(attr.get('product','Council'))} by {e(attr.get('name',''))} · {e(attr.get('handle',''))} · {e(attr.get('url',''))}</p></body></html>")
    with open(out, "w", encoding="utf-8") as f:
        f.write("".join(parts))


# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session")
    ap.add_argument("--outdir", default=None, help="where to write outputs (default: next to the session file)")
    ap.add_argument("--assets", default=os.path.join(SKILL, "assets"))
    ap.add_argument("--template", default=os.path.join(SKILL, "templates", "replay.html"))
    ap.add_argument("--no-pdf", action="store_true")
    ap.add_argument("--no-replay", action="store_true")
    ap.add_argument("--validate-only", action="store_true")
    a = ap.parse_args()

    with open(a.session, encoding="utf-8") as f:
        s = json.load(f)
    outdir = a.outdir or os.path.dirname(os.path.abspath(a.session))
    os.makedirs(outdir, exist_ok=True)

    errs, warns = validate(s)
    for w in warns:
        print(f"warning: {w}")
    if errs:
        for e_ in errs:
            print(f"error: {e_}")
        print(f"{len(errs)} error(s). Fix session.json and run again.")
        sys.exit(1)
    for w in compute(s):
        print(f"warning: {w}")
    s["meta"].setdefault("date", date.today().isoformat())
    if not s["meta"].get("attribution"):
        try:
            with open(os.path.join(a.assets, "attribution.json"), encoding="utf-8") as f:
                s["meta"]["attribution"] = json.load(f)
        except Exception:
            s["meta"]["attribution"] = {"product": "Council"}
    if a.validate_only:
        print("valid.")
        return

    session_out = os.path.join(outdir, "session.json")
    with open(session_out, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    written = [session_out]

    if not a.no_replay:
        p = os.path.join(outdir, "replay.html")
        build_replay(s, a.assets, a.template, p)
        written.append(p)

    if not a.no_pdf:
        p = os.path.join(outdir, "report.pdf")
        try:
            import reportlab  # noqa: F401
            build_pdf(s, a.assets, p)
            written.append(p)
        except ImportError:
            p = os.path.join(outdir, "report.html")
            build_report_html(s, a.assets, p)
            written.append(p)
            print("note: reportlab is not installed, wrote report.html instead (print it to PDF from a browser). To get the PDF next time: pip install reportlab")

    print(f"verdict {s['decision']['verdict']} · confidence {s['decision']['confidence']} · council composite {s['scorecard']['council_composite']}")
    for w in written:
        print(f"wrote {w}")


if __name__ == "__main__":
    main()
