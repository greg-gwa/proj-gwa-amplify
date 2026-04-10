#!/usr/bin/env python3
import asyncio, asyncpg, os, sys

async def main():
    db_pass = os.environ["DB_PASS"]
    conn = await asyncpg.connect(dsn=f'postgresql://amplify:{db_pass}@35.225.87.123:5432/amplify')
    
    total = await conn.fetchval("SELECT COUNT(*) FROM radar_items WHERE status = 'new' AND spender_name IS NOT NULL")
    distinct = await conn.fetchval("SELECT COUNT(DISTINCT spender_name) FROM radar_items WHERE status = 'new' AND spender_name IS NOT NULL AND spender_name != ''")
    buys = await conn.fetchval("SELECT COUNT(*) FROM buys")
    spenders = await conn.fetchval("SELECT COUNT(*) FROM spenders")
    aliases = await conn.fetchval("SELECT COUNT(*) FROM spender_aliases")
    
    names = await conn.fetch("""
        SELECT spender_name, COUNT(*) as cnt 
        FROM radar_items 
        WHERE status = 'new' AND spender_name IS NOT NULL AND spender_name != ''
        GROUP BY spender_name 
        ORDER BY cnt DESC 
        LIMIT 40
    """)
    
    sp_names = await conn.fetch("SELECT id, name FROM spenders ORDER BY name")
    
    print(f"Unmatched radar items: {total}")
    print(f"Distinct spender names: {distinct}")
    print(f"Buys: {buys}")
    print(f"Spenders: {spenders}")
    print(f"Aliases: {aliases}")
    print(f"\nTop unmatched spender names:")
    for r in names:
        print(f"  {r['cnt']:5d}  {r['spender_name']}")
    print(f"\nAll spenders in DB:")
    for r in sp_names:
        print(f"  {r['id']}  {r['name']}")
    
    await conn.close()

asyncio.run(main())
