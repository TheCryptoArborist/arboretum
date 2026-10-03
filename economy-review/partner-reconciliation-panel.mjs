/**
 * Review-only reconciliation status overlay for Partner Chest Revenue.
 * This module never signs, executes, swaps, persists a journal, or authorizes spending.
 * It deliberately stays blocked until canonical partner coin types and authenticated
 * shared journal storage are configured in a separately reviewed change.
 */
const PARTNERS = ['BOOM','Victory'];

function el(tag,text,cls){
  const n=document.createElement(tag);
  if(text!==undefined)n.textContent=text;
  if(cls)n.className=cls;
  return n;
}

function addReconciliation(card, partner){
  if(card.querySelector('.pr-reconciliation'))return;
  const box=el('details',undefined,'pr-reconciliation');
  const summary=el('summary','Purchase reconciliation');
  const body=el('div',undefined,'pr-reconciliation-body');
  const intro=el('p',
    'Review stage only. Production partner-token accounting remains blocked until the canonical token identity and shared accounting journal are verified.');
  const dl=el('dl');
  const rows=[
    ['Verified partner token','Not configured'],
    ['Reviewed SUI spent','Not reconciled'],
    ['Partner tokens received','Not reconciled'],
    ['Projected remaining allocation','Not reconciled'],
    ['Shared journal','Not configured']
  ];
  for(const [label,value] of rows)dl.append(el('dt',label),el('dd',value));
  const guard=el('p',
    partner+' purchases cannot be entered from this preview. Matching balance changes alone are not proof of a partner-token purchase; a reviewed transaction record is required.',
    'pr-coverage-warning');
  body.append(intro,dl,guard);
  box.append(summary,body);
  card.append(box);
}

function enhance(){
  const root=document.getElementById('partner-revenue-mount');
  if(!root)return;
  const cards=[...root.querySelectorAll('.pr-card')];
  for(const card of cards){
    const title=card.querySelector('h4')?.textContent||'';
    const partner=PARTNERS.find(p=>title.toLowerCase().startsWith(p.toLowerCase()));
    if(partner)addReconciliation(card,partner.toUpperCase()==='VICTORY'?'VICTORY':partner);
  }
}

if(typeof document!=='undefined'){
  const root=document.getElementById('partner-revenue-mount');
  if(root){
    new MutationObserver(enhance).observe(root,{childList:true,subtree:true});
    enhance();
  }
}
