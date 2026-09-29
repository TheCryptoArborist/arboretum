#!/usr/bin/env python3
"""Preview-only reward-first presentation pass after the complete current build.
No game, wallet, contract, authentication or economic changes. Production refuses.
"""
from pathlib import Path
import hashlib,json,os,re,shutil
ROOT=Path(__file__).resolve().parents[1];DIST=ROOT/'dist';SOURCE=ROOT/'reward-preview'
def sha(data):return hashlib.sha256(data).hexdigest()
def once(text,old,new):
    if text.count(old)!=1:raise RuntimeError('Unexpected presentation insertion point: '+old[:60])
    return text.replace(old,new,1)
def section(text,ident):
    found=re.search(r'<section\b[^>]*\bid="'+re.escape(ident)+r'"[^>]*>[\s\S]*?</section>',text)
    if not found:raise RuntimeError('Missing guide section '+ident)
    return found.group()
def build():
    if os.environ.get('CONTEXT')=='production':raise SystemExit('Reward-first candidate is preview-only; production publication needs separate approval.')
    preserved=['game.html','wallet.js','garden.js','sui-sdk.bundle.js','tester-guide.html','guide/guide.css','guide/player-guide.js']
    prior={name:sha((DIST/name).read_bytes()) for name in preserved}
    if os.environ.get('CI') or os.environ.get('NETLIFY'):
        for name in preserved:
            assert (DIST/name).stat().st_size>1000 and b'LOCAL LAYOUT HARNESS' not in (DIST/name).read_bytes(), 'Incomplete base build: '+name
    guide=(DIST/'player-guide.html').read_text()
    if 'data-reward-first' in guide:raise RuntimeError('Run the clean base build first.')
    template=(SOURCE/'rewards.html').read_text()
    home=(SOURCE/'home.html').read_text()
    crates=[('Seedling','Starter boost','seedling-crate.jpg','Get to know the item loop.','#crates'),('Grove','Daily helper','grove-crate.jpg','Build your everyday tool stash.','#crates'),('Canopy','Rank climber','canopy-crate.jpg','Prepare your next growth push.','#crates'),('Ancient','Power crate','ancient.jpg','Explore a broader premium toolkit.','#crates'),('Mythic','Cycle changer','mythic-crate.jpg','Discover the higher-tier selection.','#crates'),('Supply Drop','Featured item','supply-drop.jpg','Choose a featured tool directly.','#supply-drops')]
    cards=''.join(f'<article class="rf-crate"><img src="/prelaunch/{image}" alt="Original {name} artwork from the Item Shop" width="1024" height="1024" loading="lazy"><div><h3>{name}</h3><p class="rf-role">{role}</p><p>{description}</p><a href="/player-guide{anchor}">Learn more ↗</a></div></article>' for name,role,image,description,anchor in crates)
    home=once(home,'@@REWARDS@@',template);home=once(home,'@@CRATES@@',cards)
    guide=once(guide,'data-guide-audience="players"','data-guide-audience="players" data-reward-first="true"')
    oldhero=section(guide,'start')
    hero='''<section class="hero rf-guide-hero" id="start"><div class="guide-cover"><div class="guide-cover-copy"><p class="eyebrow">YOUR GUIDE TO THE SEASON’S SUI REWARDS</p><h1>Grow more than a garden.<br><em>Play for your share.</em></h1><p class="lede">In Arboretum, your goal is to build Growth Points and compete for a share of the funded SUI reward pool at season’s end. Learn what you’re playing for first—then plan the garden and tools that fit your strategy.</p><div class="actions"><a class="button primary" href="#rewards">Understand the reward ↓</a><a class="button" href="#buy-first">Plan your first garden</a></div></div><div class="guide-cover-art" aria-hidden="true"><img src="/prelaunch/hero.png" alt="" width="775" height="964"></div></div><p class="launch-note"><strong>Public gameplay is not open yet.</strong> This handbook is open to everyone. Final dates, prices, balancing and claim terms will be announced before launch.</p></section>'''
    original_rewards=section(guide,'rewards')
    claim=re.search(r'<details><summary>When do I claim\?</summary>[\s\S]*?</details>',original_rewards)
    if not claim:raise RuntimeError('Original claim explanation missing')
    rewards='<section class="section rf-rewards" id="rewards" aria-labelledby="reward-title">'+template+'<div class="rf-guide-settlement">'+claim.group()+'</div></section>'
    why='''<section class="section rf-guide-points" id="build-your-share"><p class="eyebrow">HOW YOUR CHOICES CONNECT TO THE REWARD</p><h2>Build your garden. Strengthen your position.</h2><div class="cards"><article class="card"><h3>More maintained Seeds, more point opportunities.</h3><p>Each additional eligible NFTree and separate planting payment gives you another Seed to care for, up to eight slots. Buying an NFTree alone does not start earning points.</p></article><article class="card"><h3>Better timing, more useful tools.</h3><p>Apply growth boosts before the watering you want to improve. Use protection before a dry period. A tool’s value comes from its effect and when you use it—not the purchase alone.</p></article><article class="card"><h3>Plan around the whole season.</h3><p>The current design uses a 30-day season. Starting at the opening gives you more opportunities for eligible waterings. Final opening and closing times will be announced before public participation.</p></article><article class="card"><h3>Know the commitment before spending.</h3><p>Start with an eligible NFTree, a separate planting payment and SUI for network fees. Crates are optional. Return to check your Seeds, prepare tools and water when ready.</p></article></div><p class="small">A larger garden is not a guaranteed payout multiple. Other players’ points and the funded pool determine the final share. Planned rarity bonuses are explained separately below.</p></section>'''
    guide=once(guide,original_rewards,'')
    guide=once(guide,oldhero,hero+rewards+why)
    nav=re.search(r'<nav aria-label="Guide chapters">([\s\S]*?)</nav>',guide)
    if not nav:raise RuntimeError('Guide navigation missing')
    links=re.findall(r'<a\b[^>]*>[\s\S]*?</a>',nav.group(1))
    reward_link=next(a for a in links if 'href="#rewards"' in a)
    links.remove(reward_link);links.insert(1,reward_link);links.insert(2,'<a href="#build-your-share">Build your share</a>')
    newnav=''.join(links)
    guide=guide.replace(nav.group(1),newnav)
    for a,b in [('01 / GET STARTED','03 / GET STARTED'),('02 / THE DAILY LOOP','04 / THE DAILY LOOP'),('03 / BUILD YOUR LOADOUT','05 / BUILD YOUR LOADOUT'),('04 / PLAY WITH A PLAN','06 / PLAY WITH A PLAN'),('05 / KNOW WHAT YOU ARE OPENING','07 / KNOW WHAT YOU ARE OPENING'),('06 / GROW THE COMMUNITY','08 / GROW THE COMMUNITY'),('08 / NFTREE PRIVILEGES','09 / NFTREE PRIVILEGES'),('09 / QUICK ANSWERS','10 / QUICK ANSWERS')]:guide=guide.replace(a,b)
    css=(SOURCE/'theme.css').read_text()
    if '@@' in css:raise RuntimeError('Logo mask placeholder is unresolved')
    (DIST/'index.html').write_text(home)
    (DIST/'player-guide.html').write_text(guide)
    for name in ['prelaunch/site.css','guide/player-guide.css']:
        (DIST/name).write_text((DIST/name).read_text()+'\n'+css)
    shutil.copyfile(ROOT/'assets/shop/crates/supply-drop.jpg',DIST/'prelaunch/supply-drop.jpg')
    for name,digest in prior.items():assert sha((DIST/name).read_bytes())==digest, 'Protected file changed: '+name
    for path in ['prelaunch/mark.png','prelaunch/hero.png','prelaunch/boom-chest.png','prelaunch/victory-chest.png']:
        assert (DIST/path).exists(), 'Missing original asset '+path
    assert not re.search(r'<script\b|<form\b|\bon\w+=',home,re.I)
    assert home.index('id="growth-pool"')<home.index('id="item-shop"')
    assert guide.index('id="rewards"')<guide.index('id="buy-first"')<guide.index('id="tools"')
    report={'scope':'preview-only presentation','protected_files_unchanged':prior,'homepage_sha256':sha(home.encode()),'guide_sha256':sha(guide.encode()),'original_artwork':{n:sha((DIST/'prelaunch'/n).read_bytes()) for n in ['mark.png','hero.png','boom-chest.png','victory-chest.png','supply-drop.jpg','garden-preview.avif']},'actual_pool_balance_displayed':False,'example_pool_sui':1000,'example_is_forecast':False,'production_allowed':False}
    out=ROOT/'reward-results';out.mkdir(exist_ok=True)
    (out/'build.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':build()
