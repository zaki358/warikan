"""TS 実装との同値性検証用フィクスチャを生成する。

使い方:
    python legacy/parity_dump.py > packages/shared/src/__fixtures__/flask-parity.json

ケースの制約:
  - 合計が人数で割り切れること（TS 版は端数処理を整数演算に直しているため）
  - メンバーは名前の昇順で並べること（Python は安定ソート、TS は id 昇順で tie-break するため）
"""

import json
import sys

from app import calculate_settlements

CASES = [
    {"name": "2人・片方が全額立て替え", "members": [{"name": "A", "paid": 10000}, {"name": "B", "paid": 0}]},
    {"name": "3人・全員同額", "members": [{"name": "A", "paid": 3000}, {"name": "B", "paid": 3000}, {"name": "C", "paid": 3000}]},
    {"name": "3人・1人が多く立て替え", "members": [{"name": "A", "paid": 6000}, {"name": "B", "paid": 3000}, {"name": "C", "paid": 0}]},
    {"name": "4人・債権者が2人", "members": [{"name": "A", "paid": 8000}, {"name": "B", "paid": 0}, {"name": "C", "paid": 4000}, {"name": "D", "paid": 0}]},
    {"name": "5人・ばらばら", "members": [{"name": "A", "paid": 12000}, {"name": "B", "paid": 5000}, {"name": "C", "paid": 3000}, {"name": "D", "paid": 0}, {"name": "E", "paid": 0}]},
    {"name": "2人・全員0円", "members": [{"name": "A", "paid": 0}, {"name": "B", "paid": 0}]},
    {"name": "6人・2人だけ立て替え", "members": [{"name": "A", "paid": 18000}, {"name": "B", "paid": 0}, {"name": "C", "paid": 0}, {"name": "D", "paid": 6000}, {"name": "E", "paid": 0}, {"name": "F", "paid": 0}]},
]


def main() -> None:
    dumped = []
    for case in CASES:
        members = [dict(member) for member in case["members"]]
        total = sum(member["paid"] for member in members)
        if total % len(members) != 0:
            raise ValueError(f"{case['name']}: 合計 {total} が人数 {len(members)} で割り切れない")

        total_out, per_person, settlements = calculate_settlements(members)
        dumped.append({
            "name": case["name"],
            "members": case["members"],
            "total": total_out,
            "perPerson": per_person,
            "transfers": [
                {"fromId": s["from"], "toId": s["to"], "amount": s["amount"]}
                for s in settlements
            ],
        })

    json.dump(dumped, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
