#!/usr/bin/env python3
# 卡牌卡图下载/校验工具(权威命名来自 docs/card-art-map.json)
#
# 用法:
#   python3 tools/fetch-card-art.py            # 校验本地 42 张图规格
#   python3 tools/fetch-card-art.py --fetch    # 从 wiki 重下缺失/损坏的图
#   python3 tools/fetch-card-art.py --fetch hogRider knight   # 只下指定卡
#
# 规则(吸取 2026-09-17 事故教训):
#   1. 文件名只从 docs/card-art-map.json 取,禁止猜测/拼接
#   2. 下载后必须通过规格校验(竖版比例 0.84±0.04,最长边 ≤300px)
#   3. 校验失败 = 报错退出,绝不静默兜底换素材(上次事故根因)
#   4. WebP 响应自动转 PNG
import json, subprocess, sys, os, urllib.parse, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = json.load(open(os.path.join(ROOT, 'docs/card-art-map.json')))
CARDS_DIR = os.path.join(ROOT, 'assets/cards')
API = 'https://clashroyale.fandom.com/api.php'
UA = 'Mozilla/5.0 (clashOnWEB card art fetch)'
RATIO_OK = 0.84
RATIO_TOL = 0.04
MAX_EDGE = 300


def check_image(path):
    """返回 (ok, reason)。规格:竖版卡图比例 ≈0.84,最长边 ≤300。"""
    try:
        from PIL import Image
    except ImportError:
        return True, 'no-PIL(skip)'  # 无 PIL 时跳过尺寸检查(只查文件非空)
    try:
        im = Image.open(path)
        w, h = im.size
        if h == 0:
            return False, 'zero-height'
        ratio = w / h
        if abs(ratio - RATIO_OK) > RATIO_TOL:
            return False, f'ratio {ratio:.2f} != {RATIO_OK}'
        if max(w, h) > MAX_EDGE:
            return False, f'edge {max(w,h)} > {MAX_EDGE}'
        return True, f'{w}x{h}'
    except Exception as e:
        return False, f'unreadable: {e}'


def fetch(card_id):
    info = MAP[card_id]
    fname = info.get('file')
    out = os.path.join(CARDS_DIR, card_id + '.png')
    if not fname:
        print(f'  {card_id}: 映射无文件名({info.get("note","")}),跳过(本地已有图保留)')
        return True
    q = urllib.parse.quote(fname)
    for attempt in range(3):
        u = subprocess.run(['curl', '-s', '--max-time', '20', '-A', UA,
          f'{API}?action=query&titles=File:{q}&prop=imageinfo&iiprop=url&format=json&formatversion=2'],
          capture_output=True, text=True).stdout
        try:
            d = json.loads(u)
            p = d['query']['pages'][0]
            if 'imageinfo' not in p:
                print(f'  {card_id}: wiki 无文件 {fname}——映射过期,请人工核验!')
                return False
            url = p['imageinfo'][0]['url']
            subprocess.run(['curl', '-s', '--max-time', '30', '-A', UA, '-o', out, url],
                           capture_output=True)
            if not (os.path.exists(out) and os.path.getsize(out) > 1000):
                time.sleep(2 + attempt * 3)
                continue
            # WebP 伪装 PNG → 转换
            from PIL import Image
            im = Image.open(out)
            if im.format != 'PNG':
                im.convert('RGBA').save(out, 'PNG')
            # 缩到 ≤300px
            w, h = im.size
            if max(w, h) > MAX_EDGE:
                sc = MAX_EDGE / max(w, h)
                im = im.resize((int(w * sc), int(h * sc)), Image.LANCZOS)
                im.save(out, 'PNG')
            ok, why = check_image(out)
            if not ok:
                print(f'  {card_id}: 下载后规格不符({why})——拒绝入库!')
                os.remove(out)
                return False
            print(f'  {card_id}: OK {why}')
            return True
        except Exception:
            time.sleep(2 + attempt * 3)
    print(f'  {card_id}: 网络失败')
    return False


def verify_all():
    """校验本地全部卡图规格。返回异常列表。"""
    from PIL import Image
    bad = []
    for card_id in MAP:
        if card_id == '_meta':
            continue
        p = os.path.join(CARDS_DIR, card_id + '.png')
        if not os.path.exists(p):
            bad.append((card_id, 'missing'))
            continue
        ok, why = check_image(p)
        if not ok:
            bad.append((card_id, why))
    return bad


def main():
    args = sys.argv[1:]
    do_fetch = '--fetch' in args
    targets = [a for a in args if not a.startswith('--')]

    if not do_fetch:
        bad = verify_all()
        if bad:
            print(f'规格异常 {len(bad)} 张:')
            for cid, why in bad:
                print(f'  {cid}: {why}')
            sys.exit(1)
        print('全部卡图规格正常 ✓(比例 ≈0.84,≤300px)')
        return

    os.makedirs(CARDS_DIR, exist_ok=True)
    ids = targets or [k for k in MAP if k != '_meta']
    fails = [cid for cid in ids if not fetch(cid)]
    if fails:
        print(f'\n失败: {fails}')
        sys.exit(1)
    bad = verify_all()
    if bad:
        print(f'仍异常: {bad}')
        sys.exit(1)
    print(f'\n{len(ids)} 张处理完毕,全部规格正常 ✓')


if __name__ == '__main__':
    main()
