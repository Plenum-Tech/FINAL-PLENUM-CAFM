"""Phases 1–7 — session workspace, routing, WO confidence, connectors."""
from src.agents.session_workspace import (
    ROUTE_UDR_MAP,
    ROUTE_WO_CLARIFY,
    classify_route_intent,
    default_session_state,
    score_work_request,
    work_request_confidence_band,
    workspace_has_ingestion,
)
from src.integrations.source_connectors import list_source_connectors


def test_route_intent_udr_mapping():
    state = default_session_state()
    intent = classify_route_intent("please run udr mapping now", state)
    assert intent == ROUTE_UDR_MAP


def test_route_intent_wo_clarify_when_pending():
    state = default_session_state()
    state["pending_wo_clarification"] = True
    assert classify_route_intent("hello", state) == ROUTE_WO_CLARIFY


def test_work_request_confidence_high():
    msg = "chiller at tower a keeps tripping urgent need technician today"
    assert work_request_confidence_band(msg) in ("high", "medium")
    assert score_work_request(msg) >= 0.4


def test_workspace_ingestion_fiix():
    state = default_session_state()
    state["fiix_ingestion_id"] = "abc"
    assert workspace_has_ingestion(state)


def test_source_connectors_list():
    connectors = list_source_connectors()
    types = {c["source_type"] for c in connectors}
    assert "fiix" in types
    assert "file_upload" in types
