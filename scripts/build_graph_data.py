#!/usr/bin/env python3
"""
Build 3D Pokémon Knowledge Graph data (assets/data/graph_data.json).
Aggregates all 1,346 Pokémon artworks, metadata, evolution chains,
mega forms, gmax forms, regional variants, and lore pantheons.
"""

import os
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    pokemon_data_path = os.path.join(ROOT, 'assets/data/pokemon_data.json')
    evolution_chains_path = os.path.join(ROOT, 'assets/data/evolution_chains.json')
    evolution_levels_path = os.path.join(ROOT, 'assets/data/evolution_levels.json')
    generations_path = os.path.join(ROOT, 'assets/data/generations.json')
    output_path = os.path.join(ROOT, 'assets/data/graph_data.json')

    with open(pokemon_data_path, 'r', encoding='utf-8') as f:
        pdata = json.load(f)
    pdict = {p['id']: p for p in pdata}

    with open(evolution_chains_path, 'r', encoding='utf-8') as f:
        evodata = json.load(f)

    with open(evolution_levels_path, 'r', encoding='utf-8') as f:
        ev_lvl = json.load(f)

    with open(generations_path, 'r', encoding='utf-8') as f:
        gens = json.load(f)

    img_dir = os.path.join(ROOT, 'assets/images/pokemon')
    img_files = set(os.listdir(img_dir))
    img_files.discard('10326.png')

    type_colors = {
        'Normal': '#A8A878',
        'Fire': '#F08030',
        'Water': '#6890F0',
        'Grass': '#78C850',
        'Electric': '#F8D030',
        'Ice': '#98D8D8',
        'Fighting': '#C03028',
        'Poison': '#A040A0',
        'Ground': '#E0C068',
        'Flying': '#A890F0',
        'Psychic': '#F85888',
        'Bug': '#A8B820',
        'Rock': '#B8A038',
        'Ghost': '#705898',
        'Dragon': '#7038F8',
        'Steel': '#B8B8D0',
        'Dark': '#705848',
        'Fairy': '#EE99AC',
    }

    # Collect starter IDs
    starter_ids = set()
    for g in gens:
        for sid in g.get('starters', []):
            starter_ids.add(sid)
            # Find evolutions of starters
            chain_id = pdict.get(sid, {}).get('evolution_chain_id')
            if chain_id and str(chain_id) in evodata:
                for m in evodata[str(chain_id)].get('main_line', []):
                    if m.get('id'): starter_ids.add(m['id'])

    # Pseudo-legendaries (600 club)
    pseudo_legendary_ids = {147, 148, 149, 246, 247, 248, 371, 372, 373, 374, 375, 376,
                            443, 444, 445, 633, 634, 635, 704, 705, 706, 782, 783, 784,
                            885, 886, 887, 996, 997, 998}

    # Paradox IDs
    paradox_ids = {984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995,
                   1005, 1006, 1007, 1008, 1009, 1010, 1020, 1021, 1022, 1023}

    nodes = {}

    def get_slug(name_en):
        slug = name_en.lower().strip()
        slug = slug.replace(' ', '-').replace("'", '').replace('.', '')
        slug = slug.replace('♀', '-f').replace('♂', '-m')
        return slug

    # 1. Base 1025 Pokemon
    for p in pdata:
        pid = p['id']
        if f"{pid}.png" not in img_files:
            continue

        cat = 'standard'
        if p.get('is_legendary'): cat = 'legendary'
        elif p.get('is_mythical'): cat = 'mythical'
        elif p.get('is_ultra_beast'): cat = 'ultra_beast'
        elif pid in paradox_ids: cat = 'paradox'
        elif pid in pseudo_legendary_ids: cat = 'pseudo_legendary'
        elif pid in starter_ids: cat = 'starter'
        elif p.get('is_baby'): cat = 'baby'

        main_type = p['types'][0] if p['types'] else 'Normal'
        color = type_colors.get(main_type, '#777777')

        nodes[pid] = {
            'id': pid,
            'base_id': pid,
            'name': p['names']['zh'],
            'name_en': p['names']['en'],
            'name_ja': p['names'].get('ja', ''),
            'slug': get_slug(p['names']['en']),
            'types': p['types'],
            'types_zh': p['types_zh'],
            'color': color,
            'generation': p['generation'],
            'category': cat,
            'is_legendary': p.get('is_legendary', False),
            'is_mythical': p.get('is_mythical', False),
            'is_ultra_beast': p.get('is_ultra_beast', False),
            'is_baby': p.get('is_baby', False),
            'form': None,
            'stats': p.get('stats', {}),
            'height_m': p.get('height_m'),
            'weight_kg': p.get('weight_kg'),
            'artwork': f"assets/images/pokemon/{pid}.png",
            'sprite': f"assets/images/sprite/{pid}.png",
            'has_cry': True,
        }

    # 2. Forms from evolution_chains
    for cid, chain in evodata.items():
        def register_form(item, form_type):
            nid = item.get('id')
            if not nid or nid == 10326 or nid in nodes:
                return
            if f"{nid}.png" not in img_files:
                return

            base_id = item.get('base_id')
            base_p = pdict.get(base_id, {})
            name_zh = item.get('name_zh') or item.get('base_name_zh') or base_p.get('names', {}).get('zh', '')
            name_en = item.get('name_en') or item.get('base_name_en') or base_p.get('names', {}).get('en', '')
            name_ja = base_p.get('names', {}).get('ja', '')

            ftype = form_type or item.get('form') or 'form'
            cat = ftype
            if ftype == 'mega': cat = 'mega'
            elif ftype == 'gmax': cat = 'gmax'
            elif ftype in ('alola', 'galar', 'hisui', 'paldea', 'regional', 'variant'): cat = 'regional'

            types = base_p.get('types', ['Normal'])
            types_zh = base_p.get('types_zh', ['一般'])
            main_type = types[0] if types else 'Normal'
            color = type_colors.get(main_type, '#777777')

            nodes[nid] = {
                'id': nid,
                'base_id': base_id or nid,
                'name': name_zh,
                'name_en': name_en,
                'name_ja': name_ja,
                'slug': get_slug(base_p.get('names', {}).get('en', name_en)),
                'types': types,
                'types_zh': types_zh,
                'color': color,
                'generation': base_p.get('generation', 1),
                'category': cat,
                'is_legendary': base_p.get('is_legendary', False),
                'is_mythical': base_p.get('is_mythical', False),
                'is_ultra_beast': base_p.get('is_ultra_beast', False),
                'is_baby': False,
                'form': ftype,
                'stats': base_p.get('stats', {}),
                'height_m': base_p.get('height_m'),
                'weight_kg': base_p.get('weight_kg'),
                'artwork': f"assets/images/pokemon/{nid}.png",
                'sprite': f"assets/images/sprite/{base_id}.png" if base_id else f"assets/images/pokemon/{nid}.png",
                'has_cry': bool(base_id),
            }

        for m in chain.get('main_line', []):
            if m.get('id', 0) > 1025:
                register_form(m, m.get('form'))
        for k, v in chain.get('variants', {}).items():
            if isinstance(v, list):
                for it in v: register_form(it, 'regional')
            elif isinstance(v, dict):
                register_form(v, 'regional')
        for k, v in chain.get('special_forms', {}).items():
            if isinstance(v, list):
                for it in v: register_form(it, k)
            elif isinstance(v, dict):
                register_form(v, k)

    # 3. Build Links
    links = []
    seen_links = set()

    def add_link(src, tgt, ltype, label, value=1.0):
        if src not in nodes or tgt not in nodes or src == tgt:
            return
        key = (min(src, tgt), max(src, tgt), ltype)
        if key in seen_links:
            return
        seen_links.add(key)
        links.append({
            'source': src,
            'target': tgt,
            'type': ltype,
            'label': label,
            'value': value
        })

    # 3A. Evolution Links (Levelled)
    levels = ev_lvl.get('levels', {})
    for f_id, targets in levels.items():
        fid = int(f_id)
        for t_id, lvl in targets.items():
            tid = int(t_id)
            label = f"等級 {lvl} 進化" if lvl else "等級進化"
            add_link(fid, tid, 'evolution', label, 1.2)

    # 3B. Evolution Links (Unlevelled / Special)
    unlevelled = ev_lvl.get('unlevelled', {})
    for f_id, target_list in unlevelled.items():
        fid = int(f_id)
        for it in target_list:
            tid = int(it['to'])
            trigger = it.get('trigger', 'special')
            detail = it.get('detail', '')
            label = "特殊進化"
            if 'stone' in detail: label = "道具進化"
            elif 'happiness' in detail: label = "親密度進化"
            elif 'trade' in trigger: label = "通信交換進化"
            add_link(fid, tid, 'evolution', label, 1.2)

    # 3C. Mega Evolution Links
    for nid, node in nodes.items():
        if node.get('form') == 'mega' and node.get('base_id'):
            add_link(node['base_id'], nid, 'mega', '超級進化', 1.5)

    # 3D. Gigantamax Links
    for nid, node in nodes.items():
        if node.get('form') == 'gmax' and node.get('base_id'):
            add_link(node['base_id'], nid, 'gmax', '超極巨化', 1.5)

    # 3E. Regional Form Links
    for nid, node in nodes.items():
        if node.get('category') == 'regional' and node.get('base_id'):
            add_link(node['base_id'], nid, 'regional', '地區形態', 1.4)

    # 3F. Other Special Forms
    for nid, node in nodes.items():
        if nid > 1025 and node.get('base_id') and node.get('category') not in ('mega', 'gmax', 'regional'):
            add_link(node['base_id'], nid, 'form', '形態變更', 1.3)

    # 3G. Lore Groups / Pantheon Clusters
    pantheons = [
        # 關都三聖鳥 & 洛奇亞
        ([144, 145, 146, 249], '傳說三聖鳥與海之神'),
        # 超夢 & 夢幻
        ([150, 151], '超夢與夢幻基因源起'),
        # 城都三聖獸 & 鳳王
        ([243, 244, 245, 250], '傳說三聖獸與天之彩羽'),
        # 豐緣超古代三大神話
        ([382, 383, 384], '超古代天氣之神'),
        # 水都守護神
        ([380, 381], '無限神水都守護神'),
        # 聖柱家族
        ([377, 378, 379, 486, 894, 895], '傳說聖柱巨人'),
        # 神奧時空三神 & 創世神
        ([483, 484, 487, 493], '神奧時空秩序與創世神話'),
        # 湖之三大精靈
        ([480, 481, 482], '心靈湖之三精靈'),
        # 美夢神與惡夢神
        ([488, 491], '新月與惡夢雙生'),
        # 合眾道之三龍
        ([643, 644, 646], '道之真實理想與虛無三龍'),
        # 聖劍士
        ([638, 639, 640, 647], '聖劍士四重奏'),
        # 三雲神
        ([641, 642, 645, 905], '四神雲之化身'),
        # 卡洛斯氣場三神
        ([716, 717, 718], '生命破壞秩序生態三神'),
        # 阿羅拉光輝之神
        ([791, 792, 800], '阿羅拉日月星光輝神話'),
        # 四島卡璞守護神
        ([785, 786, 787, 788], '阿羅拉四島神卡璞'),
        # 究極異獸
        ([793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806], '超空間究極異獸'),
        # 劍盾傳奇與極巨之始
        ([888, 889, 890], '傳說雙劍盾與闇夜無極'),
        # 帕底亞四災禍
        ([1001, 1002, 1003, 1004], '帕底亞封印四災禍'),
        # 太樂巴戈斯與桃歹郎厄鬼椪
        ([1017, 1024, 1025], '零之秘寶傳說宿命'),
    ]

    for p_group, p_label in pantheons:
        for i in range(len(p_group)):
            for j in range(i + 1, len(p_group)):
                add_link(p_group[i], p_group[j], 'pantheon', p_label, 1.8)

    # 3H. Starter Trios (connect generation base starters)
    for g in gens:
        s_list = g.get('starters', [])
        if len(s_list) == 3:
            add_link(s_list[0], s_list[1], 'starter_trio', f"第 {g['gen']} 世代初學者三家", 1.5)
            add_link(s_list[1], s_list[2], 'starter_trio', f"第 {g['gen']} 世代初學者三家", 1.5)
            add_link(s_list[2], s_list[0], 'starter_trio', f"第 {g['gen']} 世代初學者三家", 1.5)

    # 3I. Pseudo-Legendaries Circle
    pseudos = [149, 248, 373, 376, 445, 635, 706, 784, 887, 998]
    for i in range(len(pseudos) - 1):
        add_link(pseudos[i], pseudos[i + 1], 'pseudo_legendary', '準傳說 600 族譜系', 1.0)
    add_link(pseudos[-1], pseudos[0], 'pseudo_legendary', '準傳說 600 族譜系', 1.0)

    # 3J. Type Resonance (Within each type, link base species into constellation rings)
    from collections import defaultdict
    by_type = defaultdict(list)
    for p in pdata:
        pid = p['id']
        if pid in nodes:
            mtype = p['types'][0] if p['types'] else 'Normal'
            by_type[mtype].append(p)

    for tname, plist in by_type.items():
        # Sort by total stats to create naturally layered celestial orbits
        plist_sorted = sorted(plist, key=lambda x: x.get('stats', {}).get('total', 0))
        for i in range(len(plist_sorted) - 1):
            add_link(plist_sorted[i]['id'], plist_sorted[i+1]['id'], 'type_resonance', f'{tname}屬性星系共振', 0.6)
        if len(plist_sorted) > 2:
            add_link(plist_sorted[-1]['id'], plist_sorted[0]['id'], 'type_resonance', f'{tname}屬性星系共振', 0.6)

    # 3K. Dual-Type Cross Bridges (Weave the 18 type constellations into a single unified 3D sphere)
    for p in pdata:
        pid = p['id']
        if len(p.get('types', [])) > 1 and pid in nodes:
            sec_type = p['types'][1]
            sec_candidates = by_type.get(sec_type, [])
            if sec_candidates:
                my_tot = p.get('stats', {}).get('total', 0)
                best_match = min(sec_candidates, key=lambda x: abs(x.get('stats', {}).get('total', 0) - my_tot))
                add_link(pid, best_match['id'], 'dual_type', f'{p["types"][0]}+{sec_type}雙屬性突觸橋', 0.5)

    # Sort nodes by ID
    sorted_nodes = [nodes[k] for k in sorted(nodes.keys())]

    output_data = {
        'metadata': {
            'total_nodes': len(sorted_nodes),
            'total_links': len(links),
            'generations': 9,
            'categories': {
                'standard': sum(1 for n in sorted_nodes if n['category'] == 'standard'),
                'starter': sum(1 for n in sorted_nodes if n['category'] == 'starter'),
                'legendary': sum(1 for n in sorted_nodes if n['category'] == 'legendary'),
                'mythical': sum(1 for n in sorted_nodes if n['category'] == 'mythical'),
                'ultra_beast': sum(1 for n in sorted_nodes if n['category'] == 'ultra_beast'),
                'mega': sum(1 for n in sorted_nodes if n['category'] == 'mega'),
                'gmax': sum(1 for n in sorted_nodes if n['category'] == 'gmax'),
                'regional': sum(1 for n in sorted_nodes if n['category'] == 'regional'),
                'paradox': sum(1 for n in sorted_nodes if n['category'] == 'paradox'),
                'pseudo_legendary': sum(1 for n in sorted_nodes if n['category'] == 'pseudo_legendary'),
                'baby': sum(1 for n in sorted_nodes if n['category'] == 'baby'),
            },
            'link_types': {
                'evolution': sum(1 for l in links if l['type'] == 'evolution'),
                'mega': sum(1 for l in links if l['type'] == 'mega'),
                'gmax': sum(1 for l in links if l['type'] == 'gmax'),
                'regional': sum(1 for l in links if l['type'] == 'regional'),
                'form': sum(1 for l in links if l['type'] == 'form'),
                'pantheon': sum(1 for l in links if l['type'] == 'pantheon'),
                'starter_trio': sum(1 for l in links if l['type'] == 'starter_trio'),
                'pseudo_legendary': sum(1 for l in links if l['type'] == 'pseudo_legendary'),
            }
        },
        'nodes': sorted_nodes,
        'links': links
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"Generated {output_path}")
    print(f"Total Nodes: {len(sorted_nodes)}")
    print(f"Total Links: {len(links)}")
    print("Categories:", output_data['metadata']['categories'])
    print("Link Types:", output_data['metadata']['link_types'])

if __name__ == '__main__':
    main()
