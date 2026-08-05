import json
import os
import uuid
from datetime import date

from flask import Flask, redirect, render_template, request, session, url_for

app = Flask(__name__)
app.secret_key = "warikan-secret-key"

DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "sessions.json")
MAX_SESSIONS = 5


def load_sessions():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def write_sessions(sessions):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(sessions, f, ensure_ascii=False, indent=2)


def calculate_settlements(members):
    total = sum(m["paid"] for m in members)
    per_person = total / len(members)

    balances = [
        {"name": m["name"], "balance": round(m["paid"] - per_person, 2)}
        for m in members
    ]

    creditors = sorted(
        [dict(b) for b in balances if b["balance"] > 0],
        key=lambda x: x["balance"],
        reverse=True,
    )
    debtors = sorted(
        [dict(b) for b in balances if b["balance"] < 0],
        key=lambda x: x["balance"],
    )

    settlements = []
    i, j = 0, 0
    while i < len(creditors) and j < len(debtors):
        amount = min(creditors[i]["balance"], -debtors[j]["balance"])
        settlements.append({
            "from": debtors[j]["name"],
            "to": creditors[i]["name"],
            "amount": round(amount),
            "paid": False,
        })
        creditors[i]["balance"] -= amount
        debtors[j]["balance"] += amount
        if creditors[i]["balance"] < 0.01:
            i += 1
        if abs(debtors[j]["balance"]) < 0.01:
            j += 1

    return round(total), round(per_person), settlements


@app.route("/")
def index():
    return render_template("index.html", sessions=load_sessions())


@app.route("/new")
def new():
    session.clear()
    return redirect(url_for("step1"))


@app.route("/step1", methods=["GET", "POST"])
def step1():
    if request.method == "POST":
        session["title"] = request.form.get("title", "").strip()
        session["count"] = int(request.form["count"])
        session["mode"] = request.form["mode"]
        session.pop("settlements", None)
        session.pop("items", None)
        return redirect(url_for("step2"))
    return render_template("step1.html")


@app.route("/step2", methods=["GET", "POST"])
def step2():
    count = session.get("count", 2)
    mode = session.get("mode", "simple")

    if request.method == "POST":
        if mode == "simple":
            members = [
                {
                    "name": request.form[f"name_{i}"],
                    "paid": int(request.form.get(f"paid_{i}") or 0),
                }
                for i in range(count)
            ]
        else:
            names = [request.form[f"name_{i}"] for i in range(count)]
            item_count = int(request.form.get("item_count", 0))
            items = [
                {
                    "name": request.form.get(f"item_name_{i}", ""),
                    "amount": int(request.form.get(f"item_amount_{i}") or 0),
                    "paid_by": request.form.get(f"item_paid_by_{i}", names[0]),
                }
                for i in range(item_count)
            ]
            session["items"] = items
            paid_map = {name: 0 for name in names}
            for item in items:
                if item["paid_by"] in paid_map:
                    paid_map[item["paid_by"]] += item["amount"]
            members = [{"name": n, "paid": paid_map[n]} for n in names]

        total, per_person, settlements = calculate_settlements(members)
        session["members"] = members
        session["total"] = total
        session["per_person"] = per_person
        session["settlements"] = settlements
        return redirect(url_for("step3"))

    members = session.get("members", [])
    items = session.get("items", [])
    if mode == "simple":
        return render_template("step2_simple.html", count=count, members=members, range=range)
    return render_template("step2_items.html", count=count, members=members, items=items, range=range)


@app.route("/step3", methods=["GET", "POST"])
def step3():
    settlements = session.get("settlements", [])

    if request.method == "POST":
        action = request.form.get("action")

        if action == "update_paid":
            paid_indices = request.form.getlist("paid")
            for i, s in enumerate(settlements):
                s["paid"] = str(i) in paid_indices
            session["settlements"] = settlements
            editing_id = session.get("editing_id")
            if editing_id:
                _persist_session(settlements, editing_id)
            return redirect(url_for("step3"))

        if action == "save":
            _persist_session(settlements)
            return redirect(url_for("step3"))

    return render_template(
        "step3.html",
        title=session.get("title", ""),
        mode=session.get("mode", "simple"),
        total=session.get("total", 0),
        per_person=session.get("per_person", 0),
        settlements=settlements,
        items=session.get("items", []),
        members=session.get("members", []),
        editing_id=session.get("editing_id"),
        enumerate=enumerate,
    )


def _persist_session(settlements, editing_id=None):
    sessions = load_sessions()
    eid = editing_id or session.get("editing_id")
    entry = {
        "id": eid or str(uuid.uuid4())[:8],
        "title": session.get("title") or f"割り勘 {date.today().strftime('%m/%d')}",
        "created_at": date.today().isoformat(),
        "mode": session.get("mode", "simple"),
        "members": session.get("members", []),
        "items": session.get("items", []),
        "total": session.get("total", 0),
        "per_person": session.get("per_person", 0),
        "settlements": settlements,
    }
    sessions = [s for s in sessions if s["id"] != entry["id"]]
    sessions.insert(0, entry)
    write_sessions(sessions[:MAX_SESSIONS])
    session["editing_id"] = entry["id"]


@app.route("/history/<session_id>")
def view_history(session_id):
    saved = next((s for s in load_sessions() if s["id"] == session_id), None)
    if not saved:
        return redirect(url_for("index"))
    session.update({
        "title": saved["title"],
        "count": len(saved["members"]),
        "mode": saved["mode"],
        "members": saved["members"],
        "items": saved.get("items", []),
        "total": saved["total"],
        "per_person": saved["per_person"],
        "settlements": saved["settlements"],
        "editing_id": saved["id"],
    })
    return redirect(url_for("step3"))


@app.route("/history/<session_id>/delete", methods=["POST"])
def delete_history(session_id):
    sessions = [s for s in load_sessions() if s["id"] != session_id]
    write_sessions(sessions)
    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(debug=True)
