"""从 ECDICT 裁出星词用的离线词典，输出 data/*.js（file:// 下也能直接 <script> 加载）。

用法：python tools/build_dict.py
ECDICT 原始数据（ecdict.csv、lemma.en.txt）放在 tools/raw/，不进仓库，见 README。
"""
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'tools' / 'raw'
OUT = ROOT / 'data'

TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre']
FRQ_CAP = 25000
WORD_RE = re.compile(r"^[a-z][a-z'-]*[a-z]$")
CJK = re.compile(r'[一-鿿]')
# 派生词判定时不算数的字：词性后缀、虚词，太常见，拿来比会把不相干的词连起来
WEAK = set('的地得之者性化人物可能等使被把以其于一不有所为了与及或和')


def load_books():
    """tools/books/ 下每个 txt 是一本词书：一行一个词，第一行可以写「# 书名」，不写就用文件名。"""
    books = []
    for path in sorted((ROOT / 'tools' / 'books').glob('*.txt')):
        lines = [ln.strip() for ln in path.read_text(encoding='utf-8').splitlines() if ln.strip()]
        name = path.stem
        if lines and lines[0].startswith('#'):
            name = lines.pop(0).lstrip('#').strip()
        books.append({'id': path.stem, 'name': name, 'words': [w.lower() for w in lines]})
    return books


def clean_trans(t):
    lines = []
    for ln in t.replace('\\n', '\n').split('\n'):
        ln = ln.strip()
        if not ln or ln.startswith('[网络]'):
            continue
        lines.append(ln[:90])
    # 领域义项（[医] [计] ...）排在后面，普通义项够用时不要它们
    plain = [x for x in lines if not x.startswith('[')]
    lines = plain if plain else lines
    return '\n'.join(lines[:4])


def main():
    books = load_books()
    master = list(dict.fromkeys(w for b in books for w in b['words']))
    mset = set(master)
    rows = {}
    with open(RAW / 'ecdict.csv', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            raw = r['word']
            w = raw.lower()
            if not WORD_RE.match(w):
                continue
            # 大写词条（CORE、Polish）只在没有小写版本时补位，且必须是考试词或词书词
            upper = raw != w
            if upper and (w in rows and not rows[w][5]):
                continue
            tr = clean_trans(r['translation'])
            if not tr:
                continue
            tags = r['tag'].split()
            frq = int(r['frq'] or 0)
            bnc = int(r['bnc'] or 0)
            common = (0 < frq <= FRQ_CAP) or (0 < bnc <= FRQ_CAP) or r['oxford'] == '1'
            if not (tags or common or w in mset):
                continue
            if upper and not (tags or w in mset):
                continue
            ex = dict(x.split(':', 1) for x in r['exchange'].split('/') if ':' in x)
            # 纯屈折形式（went、books）不单独收，查词时由 lemma 表指回原形
            if '0' in ex and ex['0'] != w and w not in mset and not tags:
                continue
            mask = 0
            for i, t in enumerate(TAGS):
                if t in tags:
                    mask |= 1 << i
            rank = min(x for x in (frq, bnc, 999999) if x > 0)
            rows[w] = [w, r['phonetic'], tr, mask, rank, upper]

    miss = [w for w in master if w not in rows]
    print('master 缺词:', len(miss), miss[:20])

    words = sorted(rows, key=lambda w: (rows[w][4], w))
    idx = {w: i for i, w in enumerate(words)}

    # 屈折形式 -> 原形（喂文章时用）。rising 自己也是词条，但文里的 rising 也要算 rise 见过
    lemma = {}
    for ln in (RAW / 'lemma.en.txt').read_text(encoding='utf-8').splitlines():
        if ln.startswith(';') or '->' not in ln:
            continue
        head, forms = ln.split('->')
        base = head.split('/')[0].strip().lower()
        if base not in idx:
            continue
        for fm in forms.split(','):
            fm = fm.strip().lower()
            if fm and fm != base and WORD_RE.match(fm):
                lemma[fm] = idx[base]

    # 派生词连线：去掉前后缀能还原成词典里的另一个词，且中文释义有实字重合
    def cjk(w):
        return set(CJK.findall(rows[w][2])) - WEAK

    SUF = [('ically', ['ic', 'ical']), ('ation', ['ate', 'e', '']), ('ility', ['le', 'il']),
           ('ition', ['ite', 'e']), ('ency', ['ent']), ('ancy', ['ant']),
           ('ence', ['ent', 'e']), ('ance', ['ant', 'e', '']), ('ical', ['ic', 'y']),
           ('tion', ['te', 'e']), ('sion', ['de', 'se', 't']), ('ment', ['']),
           ('ness', ['', 'y']), ('ity', ['', 'e']), ('ive', ['e', '']), ('ize', ['', 'y']),
           ('ise', ['', 'y']), ('ist', ['', 'y']), ('ism', ['', 'e']), ('ous', ['', 'e', 'y']),
           ('able', ['', 'e', 'ate']), ('ible', ['', 'e']), ('ful', ['', 'y']),
           ('less', ['', 'y']), ('ant', ['', 'e']), ('ent', ['', 'e']), ('al', ['', 'e', 'y']),
           ('ic', ['', 'y', 'e']), ('ly', ['', 'le', 'y']), ('er', ['', 'e']), ('or', ['', 'e']),
           ('ify', ['', 'e', 'y']), ('en', ['', 'e']), ('ship', ['']), ('hood', ['']),
           ('ary', ['', 'e']), ('ory', ['e', '']), ('ure', ['', 'e']), ('ee', ['', 'e']),
           ('ion', ['', 'e'])]
    PRE = ['un', 'dis', 'in', 'im', 'il', 'ir', 'non', 'mis', 'over', 'under', 'inter', 'counter']

    def bases(w):
        for suf, reps in SUF:
            if not w.endswith(suf) or len(w) - len(suf) < 3:
                continue
            stem = w[:-len(suf)]
            for rp in reps:
                yield stem + rp
            if stem.endswith('i'):
                yield stem[:-1] + 'y'
            if len(stem) > 3 and stem[-1] == stem[-2]:
                yield stem[:-1]
        for p in PRE:
            if w.startswith(p) and len(w) - len(p) >= 4:
                yield w[len(p):]

    edges = set()
    for w in words:
        cw = None
        for b in bases(w):
            if b == w or b not in idx or len(b) < 4:
                continue
            if cw is None:
                cw = cjk(w)
            if cw & cjk(b):
                edges.add((idx[b], idx[w]))
                break

    # 家族规模统计，防止前后缀把一大片词串成一坨
    par = list(range(len(words)))

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    for a, b in edges:
        par[find(a)] = find(b)
    fam = defaultdict(int)
    for i in range(len(words)):
        fam[find(i)] += 1
    big = sorted(fam.values(), reverse=True)[:5]

    OUT.mkdir(exist_ok=True)
    dict_rows = [rows[w][:4] + [rows[w][4] if rows[w][4] < 999999 else 0] for w in words]
    payload = {
        'v': 1,
        'fields': ['w', 'ipa', 'cn', 'tags', 'rank'],
        'tags': TAGS,
        'rows': dict_rows,
        'edges': sorted(edges),
        'lemma': lemma,
    }
    js = 'window.XC_DICT=' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n'
    (OUT / 'dict.js').write_text(js, encoding='utf-8')

    bjs = 'window.XC_BOOKS=' + json.dumps([
        {'id': b['id'], 'name': b['name'], 'words': [w for w in b['words'] if w in rows]} for b in books
    ], ensure_ascii=False, separators=(',', ':')) + ';\n'
    (OUT / 'books.js').write_text(bjs, encoding='utf-8')

    print('词条', len(words), '屈折', len(lemma), '连线', len(edges), '最大家族', big)
    print('dict.js', round(len(js.encode()) / 1e6, 2), 'MB', ' books.js', len(bjs), 'B')


if __name__ == '__main__':
    main()
