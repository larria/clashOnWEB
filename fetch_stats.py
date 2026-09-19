#!/usr/bin/env python3
# 从 clashroyale.fandom.com 批量抓取卡牌数值(MediaWiki API)
# 输出 JSON: 每张卡的属性表 + level11 基准值(hp_11/dmg_11/atk_speed)
import json, re, time, urllib.request, urllib.parse, sys

WIKI = 'https://clashroyale.fandom.com/api.php'

# 我们的 cardId -> wiki 页面名
CARDS = {
  # 部队
  'knight': 'Knight',
  'archers': 'Archers',
  'goblins': 'Goblins',
  'spearGoblins': 'Spear Goblins',
  'skeletons': 'Skeletons',
  'minions': 'Minions',
  'barbarians': 'Barbarians',
  'bomber': 'Bomber',
  'giant': 'Giant',
  'miniPekka': 'Mini P.E.K.K.A',
  'musketeer': 'Musketeer',
  'valkyrie': 'Valkyrie',
  'hogRider': 'Hog Rider',
  'wizard': 'Wizard',
  'pekka': 'P.E.K.K.A',
  'prince': 'Prince',
  'babyDragon': 'Baby Dragon',
  'skeletonArmy': 'Skeleton Army',
  'witch': 'Witch',
  'balloon': 'Balloon',
  'giantSkeleton': 'Giant Skeleton',
  'golem': 'Golem',
  'minionHorde': 'Minion Horde',
  # 建筑
  'cannon': 'Cannon',
  'tesla': 'Tesla',
  'infernoTower': 'Inferno Tower',
  'bombTower': 'Bomb Tower',
  'goblinHut': 'Goblin Hut',
  'barbarianHut': 'Barbarian Hut',
  'tombstone': 'Tombstone',
  'elixirCollector': 'Elixir Collector',
  'xbow': 'X-Bow',
  'mortar': 'Mortar',
  # 法术
  'fireball': 'Fireball',
  'arrows': 'Arrows',
  'rocket': 'Rocket',
  'lightning': 'Lightning',
  'zap': 'Zap',
  'rage': 'Rage',
  'freeze': 'Freeze',
  'mirror': 'Mirror',
  # 塔(用于校准)
  '_princessTower': 'Princess Tower',
  '_kingTower': 'King Tower',
}

def fetch(page):
  url = WIKI + '?' + urllib.parse.urlencode({
    'action': 'parse', 'page': page, 'prop': 'wikitext', 'format': 'json'
  })
  req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (stats fetch)'})
  with urllib.request.urlopen(req, timeout=30) as r:
    return json.load(r)

def parse(wt):
  out = {}
  # 1) level11 基准变量
  for var, key in [('hp_11', 'hp11'), ('dmg_11', 'dmg11'), ('atk_speed', 'atkSpeed')]:
    m = re.search(r'\{\{#vardefine:\s*' + var + r'\s*\|\s*([\d.]+)\s*\}\}', wt)
    if m: out[key] = float(m.group(1))
  # 法术可能用 dmg_11 之外的变量名,兜底找 radius/crown tower damage
  m = re.search(r'\{\{#vardefine:\s*dmg_11[^}]*\}\}', wt)
  # 2) 属性表 unit-attributes-table
  idx = wt.find('unit-attributes-table')
  if idx >= 0:
    seg = wt[idx:idx+3000]
    # 表头
    headers = re.findall(r'!scope="col"\|([^<\n]+)', seg)
    headers = [h.strip() for h in headers]
    # 数据行(|- 之后的 |...||... 行)
    rowm = re.search(r'\|-+\s*\n\|(.+?)\n\|\}', seg, re.S)
    if rowm:
      cells = [c.strip() for c in rowm.group(1).split('||')]
      out['headers'] = headers
      out['cells'] = cells
  # 3) 法术表(spell 属性可能不同 id)
  if 'unit-attributes-table' not in wt:
    idx2 = wt.find('id="unit-statistics"')
    if idx2 < 0: idx2 = 0
    seg = wt[idx2:idx2+4000]
    headers = re.findall(r'!scope="col"\|([^<\n]+)', seg)
    rowm = re.search(r'\|-+\s*\n\|(.+?)\n\|\}', seg, re.S)
    if rowm and headers:
      out['headers'] = [h.strip() for h in headers]
      out['cells'] = [c.strip() for c in rowm.group(1).split('||')]
  return out

def main():
  results = {}
  fails = []
  for cid, page in CARDS.items():
    try:
      d = fetch(page)
      wt = d['parse']['wikitext']['*']
      results[cid] = parse(wt)
      results[cid]['_page'] = page
      print(f'OK {cid} ({page})', file=sys.stderr)
    except Exception as e:
      fails.append((cid, page, str(e)[:80]))
      print(f'FAIL {cid}: {e}', file=sys.stderr)
    time.sleep(0.4)
  json.dump({'cards': results, 'fails': fails}, open('/tmp/cr_stats.json', 'w'), ensure_ascii=False, indent=1)
  print(f'done. {len(results)} ok, {len(fails)} fail', file=sys.stderr)

if __name__ == '__main__':
  main()
