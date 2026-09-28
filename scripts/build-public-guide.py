#!/usr/bin/env python3
"""Build a public handbook after the existing guide/polish pipeline.
Preserve the original tester reference, game code and authentication secrets.
All content is prelaunch product documentation, not a claim of deployed parity.
"""
from pathlib import Path
from html import escape
import ast, hashlib, json, os, re
ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'dist'
# Short player-facing effects from the reviewed guide; not new game mechanics.
# ID, effect, timing, practical tip. Rarity/category/name come from the existing source.
DESCRIPTIONS=[
('fertilizer','Adds +50% to the next 3 waterings on one Seed.','Before watering.','Adds future boosted waterings, not a larger boost percentage.'),
('watering-boost','Adds +50% to the next watering on one Seed.','Before the watering you want to improve.','Combines with other boosted-watering counts; does not award points immediately.'),
('compost','Adds 1 to a Seed’s watering streak.','Before an eligible watering.','A missed-day streak reset can undo a streak boost. Check the Seed’s condition first.'),
('growth-tonic','Adds 20 Growth Points immediately to a live Seed.','On a live Seed in the active season.','It does not water the Seed or refresh its timer.'),
('miracle-grow','Prepares a 2× multiplier for the next watering.','Before watering.','Check that a doubling effect is not already queued; another application does not create a second queued doubling.'),
('mulch','Provides a short protection window for one Seed.','Before time away or a dry period.','Check the displayed expiry. Protection tools share coverage, so do not assume their durations add together.'),
('rain-barrel','Refreshes one live Seed’s last-watered timer.','Before the Seed dies.','A timer refresh is not a watering-point award and can change manual-watering readiness. It is not a revival item.'),
('super-soil','Adds 3 to a Seed’s watering streak.','Before an eligible watering.','Check dryness first: a missed-day streak reset can overwrite the boost.'),
('sunstone','Adds 30 Growth Points immediately to a live Seed.','On a live Seed in the active season.','Adds points, not water or protection.'),
('revival-kit','Revives a dead current-season Seed through the revival action.','Choose the dead Seed and use the revival action.','The Seed returns alive with its streak restarted. Points removed on death are not restored.'),
('double-dose','Prepares one 2× watering and 2 future +50% boosted waterings.','Before watering.','The doubling and one +50% boost can affect the same next watering. The remaining boost stays queued.'),
('drought-shield','Provides longer-duration protection for one Seed.','Before a longer dry period.','Check its expiry and existing protection before applying another protection item.'),
('ancient-bark','Adds 50 Growth Points immediately to a live Seed.','On a live Seed in the active season.','It does not extend the Seed’s survival timer.'),
('moon-water','Adds 5 future +50% boosted waterings.','Before watering, with enough season time left to use them.','These waterings join the same boost counter as Fertilizer.'),
('earth-core','Adds 5 future +50% boosted waterings.','Before watering.','Its described growth effect is the same as Moon Water, not a separate permanent stat increase.'),
('bottomless-can','Provides timed protection for one selected Seed.','Before time away.','Automatic watering is not a confirmed launch feature. Plan around the protection expiry rather than unattended point earning.'),
('philosophers-soil','Adds 10 future +50% boosted waterings.','Preferably early enough in the season to use the full effect.','More future waterings does not mean a higher percentage on each watering.'),
('timeless-seed','Adds 5 to a live Seed’s streak and refreshes its last-watered timer.','Check the Seed’s readiness before applying.','Can change when manual watering is ready. It is not a new planted Seed or a revival tool.'),
('crystal-water','Prepares one 2× watering and 9 future +50% boosted waterings.','Before watering.','Shares the next-watering doubling effect with Miracle Grow and Double Dose. Do not assume doublings queue.'),
('forest-heart','Adds +5 base Growth Points to each future valid watering on the selected Seed.','Early in a season, on a Seed you plan to maintain.','The effect belongs to that Seed, not every Seed in your wallet. It does not promise next-season carryover.')
]
NAV=[('start','Welcome'),('buy-first','What to buy first'),('watering','Daily care & growth'),('tools','All 20 tools'),('combinations','Timing & combinations'),('crates','Crates & Supply Drops'),('referrals','Referral rewards'),('rewards','The SUI Growth Pool'),('holder-perks','Planned holder perks'),('help','Quick answers')]
CRATES=[('Seedling','Starter boost','seedling-crate.jpg','A simple entry into common tools and the item loop.'),('Grove','Daily helper','grove-crate.jpg','A common-tool mix for ongoing garden support.'),('Canopy','Broader support','canopy-crate.jpg','A mix of common and uncommon tools.'),('Ancient','Premium toolkit','ancient.jpg','A mix including rare tools for a wider strategy.'),('Mythic','High-tier selection','mythic-crate.jpg','A higher-tier mix with a Legendary tool in its current design.')]
def digest(b): return hashlib.sha256(b).hexdigest()
def tool_metadata():
    module=ast.parse((ROOT/'scripts/build-player-guide.py').read_text())
    node=next(n for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='TOOLS' for t in n.targets))
    return {r[0]:r for r in ast.literal_eval(node.value)}
def build():
    old=(DIST/'player-guide.html').read_bytes()
    if b'data-guide-audience="players"' in old: raise SystemExit('Run the full clean guide build before this pass.')
    baseline=old.decode()
    assert 'Read this before testing' in baseline and 'tool-fertilizer' in baseline, 'Unexpected original guide'
    meta=tool_metadata()
    assert len(meta)==20 and {r[0] for r in DESCRIPTIONS}==set(meta), 'Tool directory mismatch'
    styles=re.findall(r'<style\b[^>]*>([\s\S]*?)</style>',baseline,re.I)
    assert styles, 'Original guide base styling missing'
    css='\n'.join(styles)+'\n'+(ROOT/'content/player-guide-polish.css').read_text()+'\n'+(ROOT/'content/public-player-guide.css').read_text()
    css=css.replace("url('/background6.jpg')","url('/prelaunch/forest.jpg')")
    html=(ROOT/'content/public-player-guide.html').read_text()
    nav=''.join(f'<a href="#{id}">{escape(label)}</a>' for id,label in NAV)
    cards=[]
    for id,effect,when,tip in DESCRIPTIONS:
        _,name,rarity,category,*_=meta[id]
        cards.append(f'<details class="tool" id="tool-{id}" data-rarity="{rarity}" data-category="{category}"><summary><span><span class="summary-title">{escape(name)}</span><span class="summary-meta">{rarity} · {category}</span></span></summary><div class="detail-body"><dl><dt>What it does</dt><dd>{escape(effect)}</dd><dt>When to use it</dt><dd>{escape(when)}</dd><dt>Play it wisely</dt><dd>{escape(tip)}</dd></dl><a class="deep-link" href="#tool-{id}">Link to this tool</a></div></details>')
    crates=''.join(f'<article class="handbook-crate"><img src="/prelaunch/{art}" alt="{name} crate — original in-game artwork" width="1024" height="1024" loading="lazy"><div><p class="role">{role}</p><h3>{name}</h3><p>{description}</p></div></article>' for name,role,art,description in CRATES)
    holders=''.join(f'<tr><th scope="row">{rarity}</th><td>{n}</td><td>{2*n}</td></tr>' for n,rarity in enumerate(['Common','Rare','Epic','Legendary','Mythic','One of One'],1))
    production=os.environ.get('CONTEXT')=='production' and os.environ.get('ARBORETUM_PRELAUNCH_APPROVED')=='true'
    for token,value in [('@@NAV@@',nav),('@@TOOLS@@',''.join(cards)),('@@CRATES@@',crates),('@@HOLDERS@@',holders),('@@ROBOTS@@','index,follow' if production else 'noindex,nofollow')]:html=html.replace(token,value)
    assert '@@' not in html
    assert not re.search(r'\s(?:style|on\w+)\s*=',html,re.I), 'No inline styles or event handlers in public handbook'
    assert 'Read this before testing' not in html and 'verification notes' not in html.lower()
    (DIST/'guide').mkdir(exist_ok=True)
    (DIST/'tester-guide.html').write_bytes(old)
    (DIST/'player-guide.html').write_text(html)
    (DIST/'guide/player-guide.css').write_text(css)
    (DIST/'guide/player-guide.js').write_bytes((ROOT/'content/public-player-guide.js').read_bytes())
    landing=(DIST/'index.html').read_text()
    results=ROOT/'handbook-results';results.mkdir(exist_ok=True)
    (results/'prior-homepage.html').write_text(landing)
    previous='Garden &amp; guide: invited testers only.'
    replacement='Player Guide: open to everyone. Garden: invited testers only.'
    assert landing.count(previous)==1, 'Homepage access copy drifted'
    (DIST/'index.html').write_text(landing.replace(previous,replacement))
    if production:
        robots=(DIST/'robots.txt').read_text()
        allow='Allow: /player-guide$\nAllow: /player-guide.html$\nAllow: /player-guide/$\nAllow: /guide/player-guide.css$\nAllow: /guide/player-guide.js$\n'
        (DIST/'robots.txt').write_text(robots.replace('Disallow: /\n',allow+'Disallow: /\n'))
        sitemap=(DIST/'sitemap.xml').read_text()
        (DIST/'sitemap.xml').write_text(sitemap.replace('</urlset>','<url><loc>https://treegrow.xyz/player-guide</loc></url></urlset>'))
    report={'public_guide':True,'tool_entries':len(cards),'preserved_tester_reference_sha256':digest(old),'public_guide_sha256':digest(html.encode()),'public_css_sha256':digest(css.encode()),'game_or_wallet_changes':False,'production_indexing':production,'source_basis':'Existing guide/tool source at main 779f878; planned holder design from draft PR4, not activated by this page.'}
    results=ROOT/'handbook-results';results.mkdir(exist_ok=True)
    (results/'build.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
if __name__=='__main__':build()
