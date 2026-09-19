#!/usr/bin/env python3
# 全量抓取皇室战争所有卡牌数据 → docs/card-stats.json(离线参考)
# 分批可断点:每批 BATCH 张,进度存 /tmp/cr_fetch_state.json,重跑自动续
import json, re, time, urllib.request, urllib.parse, os, sys

WIKI = 'https://clashroyale.fandom.com/api.php'
UA = {'User-Agent': 'Mozilla/5.0 (clashOnWEB offline stats fetch)'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docs', 'card-stats.json')
STATE = '/tmp/cr_fetch_state.json'
BATCH = 30

def api(params):
    url = WIKI + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def get_card_list():
  cards = []
  for cat, kind in [('Troop_Cards','troop'), ('Spell_Cards','spell'), ('Building_Cards','building')]:
    d = api({'action':'query','list':'categorymembers','cmtitle':'Category:'+cat,'format':'json','cmlimit':'300'})
    for m in d['query']['categorymembers']:
      t = m['title']
      if t.startswith('Category:') or '/' in t: continue
      cards.append((t, kind))
  return cards

def parse_wikitext(wt):
  out = {}
  for m in re.finditer(r'\{\{#vardefine:\s*([a-zA-Z_0-9]+)\s*\|\s*([\d.]+)\s*\}\}', wt):
    out.setdefault('vars', {})[m.group(1)] = float(m.group(2))
  idx = wt.find('unit-attributes-table')
  if idx >= 0:
    seg = wt[idx:idx+4000]
    headers = [h.strip() for h in re.findall(r'!scope="col"\s*\|([^<\n]+)', seg)]
    rowm = re.search(r'\|-+\s*\n\|(.+?)\n\|\}', seg, re.S)
    if rowm and headers:
      cells = [c.strip() for c in rowm.group(1).split('||')]
      attrs = {}
      for i, h in enumerate(headers[:len(cells)]):
        attrs[h] = cells[i]
      out['attributes'] = attrs
  m = re.search(r'\{\{Card Infobox\|Cost=([\d.]+)\|Rarity=(\w+)\|Type=(\w+)', wt)
  if m:
    out['info'] = {'cost': float(m.group(1)), 'rarity': m.group(2), 'type': m.group(3)}
  # 静态等级表(塔等):|1||1,400||50||62
  rows = re.findall(r'\|\-\s*\n\|(\d+)\|\|([\d,]+)\|\|(\d+)\|\|(\d+)', wt)
  if rows:
    out['levels'] = {int(l): {'hp': int(h.replace(',','')), 'dmg': int(dm), 'dps': int(dp)}
                     for l, h, dm, dp in rows}
  return out

def save(results, fails, pending, done_count):
  os.makedirs(os.path.dirname(OUT), exist_ok=True)
  meta = {
    '_meta': {
      'source': 'https://clashroyale.fandom.com (MediaWiki API)',
      'note': ('vars: wiki #vardefine 变量(*_11 与 hp_base/dmg_base 均为11级基准;'
               '建筑本体用 hut_/tomb_ 前缀;golem 页含 golem_/mite_)。'
               '全等级公式: value = var * 1.1^(level-11)。'
               '本项目缩放: 11级×0.5(公主塔 3052/109 ×0.5 = 1526/54)。'
               'attributes: unit-attributes-table(费用/攻速/速度/射程/目标/数量/运输)。'
               'levels: 静态等级表(塔)。'),
      'progress': f'{done_count} fetched, {len(pending)} pending',
      'fails': fails,
    }
  }
  json.dump({**meta, 'cards': results}, open(OUT, 'w'), ensure_ascii=False, indent=1)
  json.dump({'pending': pending, 'fails': fails}, open(STATE, 'w'), ensure_ascii=False)

def main():
  if os.path.exists(STATE):
    st = json.load(open(STATE))
    pending, fails = st['pending'], st['fails']
    results = json.load(open(OUT))['cards'] if os.path.exists(OUT) else {}
  else:
    pending = get_card_list() + [('Princess Towers','tower'), ("King's Tower",'tower')]
    fails, results = [], {}
  n = 0
  while pending and n < BATCH:
    page, kind = pending.pop(0)
    try:
      d = api({'action':'parse','page':page,'prop':'wikitext','format':'json'})
      wt = d['parse']['wikitext']['*']
      if '#redirect' in wt[:200]:
        fails.append([page, 'redirect'])
      else:
        r = parse_wikitext(wt)
        r['kind'] = kind; r['page'] = page
        results[page] = r
    except Exception as e:
      fails.append([page, str(e)[:60]])
    n += 1
    time.sleep(0.3)
  save(results, fails, pending, len(results))
  print(f'batch done: +{n}, total {len(results)}, pending {len(pending)}, fails {len(fails)}')
  if pending:
    print('rerun to continue')

if __name__ == '__main__':
  main()
