#!/usr/bin/env python3
"""Usage: ingest.py <house> <display_name> <page_no> <tree_json_path> <pagetext_path>
Parses a TheRealReal designer handbags listing (accessibility tree + page text), writes trr_item_reads, prints count."""
import sys, os, json, re, sqlite3, datetime, statistics
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
house, display, page_no, tree_path, text_path = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
today = datetime.date.today().isoformat()

# ---------- tree ----------
raw = json.load(open(tree_path))
tree = raw[0]['text'] if isinstance(raw, list) else raw
blocks = re.split(r'\n(?= presentation \[ref_\d+\]\n)', tree)
PRICE = re.compile(r'^\$([\d,]+)\.\d\d$')
EST = re.compile(r'^(\d+)% Off Est\. Retail \$([\d,]+)')
EST2 = re.compile(r'^Est\. Retail \$([\d,]+)')  # bare form shown beside a "Now N% off" markdown
tiles = []
next_href = None
m = re.search(r'link "Next page" \[ref_\d+\] href="([^"]+)"', tree)
if m: next_href = m.group(1)
for b in blocks:
    hm = re.search(r'href="/products/[^"]*?/([^/"?]+)(?:\?[^"]*)?"', b)
    if not hm: continue
    slug = hm.group(1)
    if os.environ.get('TRR_STRICT') and ('link "%s ' % display) not in b: continue  # drop tiles from other designers in brand-less keyword searches
    lines = re.findall(r'^  (\w+) "((?:[^"\\]|\\.)*)"', b, re.M)  # indent-2 generics/links
    img = re.search(r'image "((?:[^"\\]|\\.)*)"', b)
    title = img.group(1) if img else None
    cond = None; price=None; est=None; pct_off=None; badges=[]; prices=[]
    cm = re.search(r'^  generic "([^"]*)" \[ref_\d+\]\n   generic "Condition:"', b, re.M)
    if cm: cond = cm.group(1)
    for role, txt in lines:
        if role != 'generic': continue
        if txt == title or txt == cond or txt == display or txt == 'Condition:': continue
        pm = PRICE.match(txt)
        if pm: prices.append(float(pm.group(1).replace(',',''))); continue
        em = EST.match(txt)
        if em: pct_off=int(em.group(1)); est=float(em.group(2).replace(',','')); continue
        em2 = EST2.match(txt)
        if em2: est=float(em2.group(1).replace(',','')); continue
        if txt.startswith('Select location'): break  # page footer reached (last tile's block)
        badges.append(txt)
    if not title:
        lm = re.search(r'link "%s (.*?)" \[ref' % re.escape(display), b)
        title = lm.group(1) if lm else slug
    prior = None
    if prices:
        price = prices[-1]
        if len(prices) > 1: prior = prices[0]
    tiles.append(dict(slug=slug, title=title, cond=cond, price=price, prior=prior, est=est, pct_off=pct_off, badges=badges))

# ---------- page text (saves) ----------
txt = [l.strip() for l in open(text_path, encoding='utf-8').read().split('\n') if l.strip()]
saves_seq = []  # (title, saves)
i = 0
while i < len(txt):
    if txt[i] == display and i+1 < len(txt) and txt[i+1] != 'Handbags':
        title = txt[i+1]; j = i+2
        # advance to price line
        while j < len(txt) and not PRICE.match(txt[j]): j += 1
        if j >= len(txt): break
        k = j+1; ints=[]
        while k < len(txt) and re.fullmatch(r'\d{1,4}', txt[k]): ints.append(int(txt[k])); k += 1
        # pagination heuristic: ascending run starting at 1 followed by '…' or end means pagination
        saves = None
        if ints:
            is_pag_tail = (k < len(txt) and txt[k] in ('…','...')) or k >= len(txt)
            if is_pag_tail and ints[0] == 1 and len(ints) >= 2 and ints[1] == 2:
                saves = None
            else:
                saves = ints[0]
        saves_seq.append((title, saves))
        i = j+1
    else:
        i += 1
# map saves to tiles by order, validating title
if len(saves_seq) != len(tiles):
    print(f"WARN tile count mismatch tree={len(tiles)} text={len(saves_seq)}", file=sys.stderr)
by_title = {}
for t, s in saves_seq: by_title.setdefault(t, []).append(s)
for idx, tl in enumerate(tiles):
    s = None
    if idx < len(saves_seq) and saves_seq[idx][0] == tl['title']: s = saves_seq[idx][1]
    elif tl['title'] in by_title and by_title[tl['title']]: s = by_title[tl['title']].pop(0)
    tl['saves'] = s

# ---------- classification ----------
def year_tag(t):
    m = re.search(r'\b(19[89]\d|20[0-2]\d)\b', t)
    return int(m.group(1)) if m else None

MODELS = {
 'Chanel': [(r'Souplissimo','Souplissimo'),(r'urban essentials?','Urban Essentials'),(r'Kelly Shopp','Kelly Shopper'),(r'Neo Cabas','Neo Cabas'),(r'\b31\b.*Shopping|31 Shopping','31 Shopping Bag'),(r'Chic Lady','Chic Lady Shopping Bag'),(r'Bucket','Bucket Bag'),(r'Pony Hair.*Clutch','Pony Hair Clutch'),
            (r'\b25\b','Chanel 25'),(r'\b22\b','Chanel 22'),(r'\b19\b','Chanel 19'),(r'\bBoy\b','Boy'),
            (r'Wallet [Oo]n Chain|\bWOC\b','Wallet on Chain'),(r'Reissue|2\.55','Reissue 2.55'),(r'Gabrielle','Gabrielle'),(r'Deauville','Deauville'),
            (r'Coco Handle','Coco Handle'),(r'Vanity','Vanity Case'),(r'Trendy CC','Trendy CC'),(r'Business Affinity','Business Affinity'),
            (r'(Classic|Timeless|Jumbo|Maxi|Rectangular Mini|Square Mini|Double|Single).*Flap|Flap.*(Classic|Timeless)','Classic Flap'),
            (r'Grand Shopping|GST','GST'),(r'Flap','Flap (other)'),(r'Tote|Cabas|Shopping','Tote (other)')],
 'Hermès': [(r'Birkin','Birkin'),(r'Kelly','Kelly'),(r'Constance','Constance'),(r'Picotin','Picotin'),(r'Evelyne','Evelyne'),(r'Lindy','Lindy'),
            (r'Garden Party','Garden Party'),(r'Bolide','Bolide'),(r'Herbag','Herbag'),(r'Jypsi','Jypsiere'),(r'Halzan','Halzan'),(r'Verrou','Verrou'),(r'Roulis','Roulis'),(r'Toolbox','Toolbox'),(r'Della Cavalleria','Della Cavalleria'),(r'Mosaique','Mosaique'),(r'Trim','Trim'),(r'Plume','Plume'),(r'Victoria','Victoria'),(r'Bride|Brides','Bride-a-Brac'),(r'Geta','Geta'),(r'In-The-Loop|In The Loop','In-The-Loop'),(r'Cabas|Cabag','Cabas'),(r'Berline','Berline'),(r'Cinhetic','Cinhetic'),(r'24/24','24/24'),(r'Aline','Aline'),(r'Steve','Steve')],
 'Alaïa': [(r'Teckel','Le Teckel'),(r'Papa','Le Papa'),(r'Mina','Mina'),(r'C[oœ]ur','Le Coeur'),(r'Khaima','Khaima'),(r'Hinge','Le Hinge'),(r'Demi Lune','Demi Lune'),(r'Pouch','Pouch'),(r'Tote','Tote (other)')],
 'Bottega Veneta': [(r'Pouch','Pouch'),(r'Cassette','Cassette'),(r'Jodie','Jodie'),(r'Andiamo','Andiamo'),(r'Sardine','Sardine'),(r'Arco','Arco'),(r'Kalimero','Kalimero'),(r'\bHop\b','Hop'),(r'Knot','Knot'),(r'Veneta','Veneta'),(r'Olimpia','Olimpia'),(r'Lauren','Lauren 1980'),(r'Campana','Campana'),(r'Intrecciato|Woven','Intrecciato (other)')],
 'Loewe': [(r'Puzzle','Puzzle'),(r'Flamenco','Flamenco'),(r'Hammock','Hammock'),(r'\bGate\b','Gate'),(r'Squeeze','Squeeze'),(r'Paseo','Paseo'),(r'Amazona','Amazona'),(r'Pebble','Pebble'),(r'Balloon','Balloon'),(r'Cubi','Cubi'),(r'Basket','Basket'),(r'Anagram','Anagram'),(r'Barcelona','Barcelona'),(r'Goya','Goya'),(r'Elephant|Bunny|Panda|Animal','Animal'),(r'Tote','Tote (other)')],
 'Celine': [(r'Triomphe','Triomphe'),(r'Luggage','Luggage'),(r'Classic Box|Box Bag|\bBox\b|\bClassic\b(?! Flap)','Classic Box'),(r'Trapeze','Trapeze'),(r'Phantom','Phantom'),(r'Belt','Belt'),(r'Cabas','Cabas'),(r'\bAva\b','Ava'),(r'\b16\b','16'),(r'Trio','Trio'),(r'Romy','Romy'),(r'Tabou','Tabou'),(r'Nano|Micro','Luggage'),(r'Macadam','Macadam (vintage)'),(r'Sangle','Sangle'),(r'Clasp','Clasp'),(r'Tote','Tote (other)')],
 'Dior': [(r'Lady','Lady Dior'),(r'Saddle','Saddle'),(r'Book Tote|\bBook\b','Book Tote'),(r'Caro','Caro'),(r'30 Montaigne|Montaigne','30 Montaigne'),(r'Bobby','Bobby'),(r'Diorama','Diorama'),(r'Diorissimo','Diorissimo'),(r'Toujours','Dior Toujours'),(r'D-Joy|Joy','D-Joy'),(r'Trotter','Trotter (vintage)'),(r'Miss Dior','Miss Dior'),(r'Cannage','Cannage (other)'),(r'Oblique','Oblique (other)')],
 'Louis Vuitton': [(r'Multi Pochette','Multi Pochette'),(r'Pochette M[eé]tis|\bM[eé]tis\b','Pochette Métis'),(r'Pochette','Pochette'),(r'Speedy','Speedy'),(r'Neverfull','Neverfull'),(r'Alma','Alma'),(r'Capucines','Capucines'),(r'Keepall','Keepall'),(r'Twist','Twist'),(r'OnTheGo|On The Go','OnTheGo'),(r'Petite Malle','Petite Malle'),(r'No[eé]','Noé'),(r'Loop','Loop'),(r'Coussin','Coussin'),(r'Dauphine','Dauphine'),(r'Papillon','Papillon'),(r'Palm Springs','Palm Springs'),(r'Montaigne','Montaigne'),(r'Side Trunk','Side Trunk'),(r'Diane','Diane'),(r'Carryall','Carryall'),(r'Bagatelle','Bagatelle'),(r'Croissant','Croissant'),(r'Boulogne','Boulogne'),(r'Favorite','Favorite'),(r'Metis','Metis')],
 'Fendi': [(r'Baguette','Baguette'),(r'Peekaboo','Peekaboo'),(r'\bFirst\b','First'),(r'Mon Tr[eé]sor','Mon Tresor'),(r'Sunshine','Sunshine'),(r'By The Way','By The Way'),(r'Kan I|Kan U','Kan'),(r'\bSpy\b','Spy'),(r'Zucca|Zucchino','Zucca (other)'),(r'Mama','Mama Baguette'),(r'Fendigraphy','Fendigraphy')],
 'Prada': [(r'Re-Edition|Re Edition','Re-Edition'),(r'Galleria','Galleria'),(r'Cleo','Cleo'),(r'Arqu[eé]','Arque'),(r'Buckle','Buckle'),(r'Symbole','Symbole'),(r'Tessuto|Nylon','Nylon (other)'),(r'Saffiano','Saffiano (other)'),(r'Cahier','Cahier'),(r'Sidonie','Sidonie'),(r'Moon','Moon')],
 'The Row': [(r'Margaux','Margaux'),(r'Park','Park Tote'),(r'Half Moon','Half Moon'),(r'Bindle','Bindle'),(r'Ascot','Ascot'),(r'Everyday','Everyday'),(r'Sofia','Sofia'),(r'Idaho','Idaho'),(r'Terrasse','Terrasse'),(r'Marlo','Marlo'),(r'Emy','Emy'),(r'Soft Margaux','Margaux'),(r'Lunch','Lunch Bag'),(r'Hunting','Hunting'),(r'Tote','Tote (other)')],
 'Miu Miu': [(r'Wander','Wander'),(r'Arcadie','Arcadie'),(r'Beau','Beau'),(r'Aventure','Aventure'),(r'Matelass[eé]','Matelassé (other)'),(r'Pocket','Pocket'),(r'Coffer','Coffer'),(r'Vitello','Vitello (other)')],
 'Balenciaga': [(r'Le Cagole|Cagole','Le Cagole'),(r'City','City'),(r'Rodeo','Rodeo'),(r'Hourglass','Hourglass'),(r'\bFirst\b','First'),(r'Motocross|Moto','Motocross (other)'),(r'Neo Classic|Neo','Neo Classic'),(r'Town','Town'),(r'Velo','Velo'),(r'Papier','Papier'),(r'Work','Work'),(r'Day','Day'),(r'Crush','Crush'),(r'Bistro','Bistro'),(r'Monaco','Monaco'),(r'Bel Air','Bel Air')],
 'Gucci': [(r'Marmont','Marmont'),(r'Dionysus','Dionysus'),(r'Horsebit','Horsebit'),(r'Jackie','Jackie'),(r'Bamboo','Bamboo'),(r'Ophidia','Ophidia'),(r'Soho','Soho'),(r'Diana','Diana'),(r'Sylvie','Sylvie'),(r'Padlock','Padlock'),(r'Blondie','Blondie'),(r'Aphrodite','Aphrodite'),(r'Interlocking','Interlocking G (other)'),(r'Boston','Boston'),(r'Emily','Emily'),(r'Tote','Tote (other)')],
 'Ferragamo': [(r'\bHug\b','Hug'),(r'Gancini','Gancini (other)'),(r'Vara','Vara'),(r'Trifolio','Trifolio'),(r'Studio','Studio'),(r'Wanda','Wanda'),(r'Tote','Tote (other)')],
 'Saint Laurent': [(r'Loulou|LouLou|Lou Lou','Loulou'),(r'Sac de Jour|Sac De Jour','Sac de Jour'),(r'Niki','Niki'),(r'Kate','Kate'),(r'Icare','Icare'),(r'Manhattan','Manhattan'),(r'5 [àa] 7|5 A 7','Le 5 à 7'),(r'Solferino','Solferino'),(r'Envelope','Envelope'),(r'Sunset','Sunset'),(r'Cassandra|Cassandre','Cassandra'),(r'Jamie','Jamie'),(r'\bLou\b','Lou'),(r'Muse','Muse'),(r'College','College'),(r'Puffer','Puffer'),(r'Bea','Bea'),(r'Monogram','Monogram (other)')],
}
def model_guess(h, t):
    for pat, name in MODELS.get(h, []):
        if re.search(pat, t, re.I if pat.islower() else 0): return name
    return 'other'

def era_guess(h, t, y):
    if h == 'Chanel':
        if (y and y >= 2026) or re.search(r"M[ée]tiers d.Art 2026|Paris[-–]New York 2026|2026 Paris[-–]New York|Souplissimo|[Uu]rban Essentials?|Neo Cabas|Chic Lady|Kelly Shopp", t): return 'Blazy 2025–'  # Blazy-only lines
        if re.search(r'Paris[-–]New York', t) and not y: return 'Blazy 2025–'
        if re.search(r'Paris-(Rome|Cuba|New York|Dallas|Salzburg|Bombay|Byzance|Shanghai|Moscou|Londres|Edimbourg|Dubai|Seoul|Hamburg|Venise|Monte Carlo|Versailles|Cosmopolite|Hollywood|Egypt)', t): return 'Lagerfeld pre-2019'
        if re.search(r'Vintage|Supermodel|Chocolate Bar|Cambon|Gabrielle|Coco Cabas|Boy Brick|Girl', t): return 'Lagerfeld pre-2019'
        if y:
            if y >= 2026: return 'Blazy 2025–'
            if y >= 2019: return 'Viard 2019–2024'
            if y < 2019: return 'Lagerfeld pre-2019'
        if re.search(r'\b25\b|\b22\b', t): return 'Viard 2019–2024'
        if re.search(r'\b19\b|Pending CC|Coco Neige', t): return 'Viard 2019–2024'
        return 'unknown'
    if h == 'Alaïa':
        if (y and y >= 2021) or re.search(r'Teckel|Papa|Mina|C[oœ]ur|Khaima|Hinge|Demi Lune', t): return 'Mulier 2021–2026'
        if y and y < 2021: return 'pre-Mulier'
        return 'unknown'
    if h == 'Bottega Veneta':
        if y:
            if y >= 2026: return 'Trotter BV 2025–'
            if y >= 2022: return 'Blazy BV 2021–2025'
            if y >= 2018: return 'Daniel Lee BV 2018–2021'
            return 'Maier BV 2001–2018'
        if re.search(r'Andiamo|Sardine|Kalimero|\bHop\b|Lauren|Gemelli', t): return 'Blazy BV 2021–2025'
        if re.search(r'Pouch|Cassette|Jodie|Arco', t): return 'Daniel Lee BV 2018–2021'
        if re.search(r'Knot|Veneta|Olimpia|Campana|Roma|Nodini', t): return 'Maier BV 2001–2018'
        return 'unknown'
    if h == 'Loewe':
        if y:
            if y >= 2026: return 'Proenza Loewe 2025–'
            if y >= 2014: return 'Anderson Loewe 2013–2025'
            return 'pre-Anderson Loewe'
        if re.search(r'Puzzle|Hammock|Gate|Squeeze|Paseo|Pebble|Balloon|Cubi|Basket|Elephant|Bunny|Panda|Goya|Flamenco Clutch|Flamenco', t): return 'Anderson Loewe 2013–2025'
        if re.search(r'Amazona|Vintage', t): return 'pre-Anderson Loewe'
        return 'unknown'
    if h == 'Celine':
        if y:
            if y >= 2019: return 'Slimane Celine 2018–2024'
            if y >= 2009: return 'Philo Celine 2008–2017'
            return 'pre-Philo Celine'
        if re.search(r'Luggage|Nano|Micro|Classic Box|Box Bag|\bBox\b|Trapeze|Phantom|Belt|Cabas|Trio|Big Bag|Clasp|Sangle|Twisted|Blade|Frame|Edge', t): return 'Philo Celine 2008–2017'
        if re.search(r'Triomphe|\b16\b|\bAva\b|Romy|Tabou|Folco|Claude|Cuir Triomphe', t): return 'Slimane Celine 2018–2024'
        if re.search(r'Macadam|Vintage|Horse Carriage|Sulky', t): return 'pre-Philo Celine'
        return 'unknown'
    if h == 'Dior':
        if y:
            if y >= 2026: return 'Anderson Dior 2025–'
            if y >= 2017: return 'Chiuri Dior 2016–2025'
            if y >= 2012: return 'Simons Dior 2012–2015'
            if y >= 1997: return 'Galliano Dior 1996–2011'
            return 'pre-Galliano Dior'
        if re.search(r'Book Tote|Caro|30 Montaigne|Bobby|Toujours|D-Joy|Oblique|Dior Travel|Vibe|Saddle.*Oblique|Micro', t): return 'Chiuri Dior 2016–2025'
        if re.search(r'Diorama|Diorissimo|Be Dior|Dioraddict|Diorever|Diorling', t): return 'Simons Dior 2012–2015'
        if re.search(r'Vintage|Trotter|Rasta|Street Chic|Flight|Gaucho|Malice|Columbus|Double Saddle|Romantique|Detective|Jeanne|Babe', t): return 'Galliano Dior 1996–2011'
        return 'unknown'
    if h == 'Gucci':
        if y:
            if y >= 2016 and y <= 2022: return 'Michele Gucci 2015–2022'
            if y >= 2023: return 'De Sarno Gucci 2023–2025'
            if y >= 2006: return 'Giannini Gucci 2006–2014'
            if y >= 1995: return 'Ford Gucci 1994–2004'
        if re.search(r'Marmont|Dionysus|Ophidia|Sylvie|Padlock|Rajah|Zumi|Queen Margaret|1955', t): return 'Michele Gucci 2015–2022'
        if re.search(r'Blondie|Aphrodite|Softbit', t): return 'De Sarno Gucci 2023–2025'
        if re.search(r'Soho|Emily|Bamboo Shopper|Interlocking', t): return 'Giannini Gucci 2006–2014'
        if re.search(r'Vintage|Tom Ford|Jackie O', t): return 'pre-2005 Gucci'
        return 'unknown'
    if h == 'Balenciaga':
        if y:
            if y >= 2016: return 'Demna Balenciaga 2015–2025'
            if y >= 2013: return 'Wang Balenciaga 2012–2015'
            if y >= 1998: return 'Ghesquière Balenciaga 1997–2012'
        if re.search(r'Cagole|Hourglass|Rodeo|Neo Classic|Crush|Bistro|Monaco|Bel Air|BB|Everyday|Ville|Shopping|Downtown|Barbes', t): return 'Demna Balenciaga 2015–2025'
        if re.search(r'City|First|Motocross|Town|Velo|Work|Day|Papier|Part Time|Giant|Twiggy|Weekender|Hip|Envelope', t): return 'Ghesquière Balenciaga 1997–2012'
        return 'unknown'
    if h == 'Saint Laurent':
        if y:
            if y >= 2017: return 'Vaccarello SL 2016–'
            if y >= 2013: return 'Slimane SL 2012–2016'
            return 'pre-Slimane YSL'
        if re.search(r'Loulou|Niki|Icare|Manhattan|5 [àa] 7|Solferino|Kate|Jamie|Puffer|Sunset|Bea|Le 37|Gaby|Calypso', t): return 'Vaccarello SL 2016–'
        if re.search(r'Sac de Jour|Sac De Jour|Duffle|Classic Monogram|Cabas|College|Blogger', t): return 'Slimane SL 2012–2016'
        if re.search(r'Muse|Downtown|Tribute|Easy|Roady|Vintage|Rive Gauche|Mombasa|Cassandre', t): return 'pre-Slimane YSL'
        return 'unknown'
    if h == 'Fendi':
        if y:
            if y >= 2021: return 'Kim Jones Fendi 2020–2024'
            if y >= 2026: return 'Chiuri Fendi 2025–'
            return 'Venturini Fendi pre-2020'
        if re.search(r'First|Fendigraphy|Sunshine|O.Lock|Peekaboo ISeeU|Flip', t): return 'Kim Jones Fendi 2020–2024'
        if re.search(r'Spy|Vintage|Mama|Zucca|Zucchino|Oyster|Chef|B Bag|By The Way|Kan I|Mon Tresor|Dotcom|Runaway', t): return 'Venturini Fendi pre-2020'
        return 'unknown'
    if h == 'Prada':
        if y:
            if y >= 2021: return 'Simons-Prada 2020–'
            return 'Miuccia Prada pre-2020'
        if re.search(r'Cleo|Symbole|Arqu[eé]|Buckle|Moon|Triangle|Supernova|Aim[eé]e', t): return 'Simons-Prada 2020–'
        if re.search(r'Vintage|Cahier|Sidonie|Tessuto|Nylon|Saffiano|Galleria|Double|Esplanade|Bibliotheque', t): return 'Miuccia Prada pre-2020'
        return 'unknown'
    if h == 'Miu Miu':
        if y and y >= 2022: return 'Miu Miu 2022– (hype era)'
        if re.search(r'Wander|Arcadie|Beau|Aventure|Pocket|Chevron', t): return 'Miu Miu 2022– (hype era)'
        if re.search(r'Coffer|Vintage|Vitello Lux|Bow', t): return 'Miu Miu pre-2022'
        return 'unknown'
    if h == 'Louis Vuitton':
        if y:
            if y >= 2014: return 'Ghesquière LV 2013–'
            if y >= 1998: return 'Jacobs LV 1997–2013'
            return 'pre-Jacobs LV'
        if re.search(r'Capucines|Twist|Petite Malle|Dauphine|Coussin|Side Trunk|OnTheGo|Multi Pochette|Diane|Loop|Bagatelle|Croissant|Carryall|Metis|Palm Springs', t): return 'Ghesquière LV 2013–'
        if re.search(r'Vintage|Multicolore|Murakami|Graffiti|Cerises|Takashi|Vernis|Manhattan|Hudson|Beverly|Trevi|Tivoli|Galliera|Artsy|Delightful|Montorgueil|Sologne|Looping|Croissant|Papillon', t): return 'Jacobs LV 1997–2013'
        return 'unknown'
    if h == 'The Row':
        return 'Olsens The Row 2006–'
    if h == 'Hermès':
        return 'unknown'
    return 'unknown'

# ---------- write ----------
con = sqlite3.connect(DB)
rows = []
for tl in tiles:
    t = tl['title'] or ''
    y = year_tag(t)
    sold = 1 if any(b.strip().lower() == 'sold' for b in tl['badges']) else 0
    extras = []
    if tl['saves'] is not None: extras.append(f"saves={tl['saves']}")
    if tl['badges']: extras.append('; '.join(tl['badges']))
    if tl['pct_off']: extras.append(f"-{tl['pct_off']}% vs est. retail")
    if tl['prior']: extras.append(f"was ${tl['prior']:.0f}")
    full_title = t + (f" [{'; '.join(extras)}]" if extras else '')
    pct = round(100*tl['price']/tl['est'],1) if (tl['est'] and tl['price']) else None
    rows.append((today, house, full_title, y, era_guess(house, t, y), model_guess(house, t), tl['cond'], tl['est'], tl['price'], pct, sold, tl['slug']))
con.executemany("INSERT OR REPLACE INTO trr_item_reads(read_date,house,title,year_tag,era_guess,model_guess,condition,est_retail,price,pct_of_retail,sold,slug) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
con.commit()
n_today = con.execute("select count(*) from trr_item_reads where read_date=date('now')").fetchone()[0]
n_house = con.execute("select count(*) from trr_item_reads where read_date=date('now') and house=?", (house,)).fetchone()[0]
print(f"{house} p{page_no}: parsed {len(tiles)} tiles (text tiles {len(saves_seq)}), wrote {len(rows)}; with_est={sum(1 for r in rows if r[7])}; saves_known={sum(1 for t in tiles if t['saves'] is not None)}; sold={sum(r[10] for r in rows)}")
print(f"TODAY COUNT: {n_today}  ({house} today: {n_house})")
print("badges seen:", sorted({b for t in tiles for b in t['badges']}))
print("models:", {m: sum(1 for r in rows if r[5]==m) for m in sorted({r[5] for r in rows})})
print("eras:", {m: sum(1 for r in rows if r[4]==m) for m in sorted({r[4] for r in rows})})
print("NEXT:", next_href)
con.close()
