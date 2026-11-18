import os, re, sys
src, out = sys.argv[1], sys.argv[2]

def blocks(css):
    res=[]; depth=0; start=0
    for i,ch in enumerate(css):
        if ch=='{': depth+=1
        elif ch=='}':
            depth-=1
            if depth==0: res.append(css[start:i+1].strip()); start=i+1
    return res

def split_selectors(sel):
    parts=[]; depth=0; cur=''
    for ch in sel:
        if ch=='(': depth+=1
        if ch==')': depth-=1
        if ch==',' and depth==0: parts.append(cur); cur=''
        else: cur+=ch
    parts.append(cur)
    return [p.strip() for p in parts]

# Re-scope the selectors that relied on Vue scoping ([data-v-*]) once it is removed.
SCOPES = {
    'OsCheckbox': [(r'^label', 'label[data-testid=os-checkbox]')],
    'OsRadio': [(r'^label', 'label[data-testid=os-radio-label]')],
    'OsSwitch': [(r'^label', 'label[data-testid=os-switch]')],
    'OsButton': [(r'^\.disabled', '.os-button.disabled')],
    'OsFloatingButton': [(r'^\.(primary|secondary)', r'.os-floating-button.\1')],
    'OsInputGroup': [(r'^\.content', '.os-input-group-child .content')],
    'OsAlert': [(r'^\.single-line', '.os-alert.single-line')],
}

def rescope(comp, block):
    if block.startswith('@') or comp not in SCOPES: return block
    i=block.index('{'); sel, body = block[:i], block[i:]
    new=[]
    for part in split_selectors(sel):
        if 'os-' not in part.split(' ')[0]:
            for pat, rep in SCOPES[comp]:
                part2=re.sub(pat, rep, part)
                if part2!=part: part=part2; break
        new.append(part)
    return ','.join(new)+body

seen=set(); parts=[]
order=['OsIcon','OsLoadingEl','OsDot','OsTextHighlighter','inputMode','OsInputGroup','OsInputText','OsInputNumber','OsMenu','OsGroupedMenu','OsFloatingLayout']
files=sorted(os.listdir(src), key=lambda f:(order.index(f[:-4]) if f[:-4] in order else 99, f))
total=0
for f in files:
    comp=f[:-4]
    css=re.sub(r'\[data-v-[a-z0-9]+\]','',open(os.path.join(src,f)).read())
    kept=[]
    for b in blocks(css):
        if 'floating-layout-slot' in b: continue
        b=rescope(comp,b)
        if b in seen: continue
        seen.add(b); kept.append(b)
    total+=len(kept)
    if kept: parts.append(f'/* {comp} */\n'+'\n'.join(kept))
header='''/*
 * OneStock design system - component styles (version published on https://design-system.onestock-retail.com).
 * Generated from the per-component stylesheets of the storybook build: Vue scoping removed, selectors that relied
 * on it re-scoped to their component. Only used when @onestock-public/design-system is not installed.
 */
'''
open(out,'w').write(header+'\n'.join(parts)+'\n')
print(len(files),'files',total,'rules')
