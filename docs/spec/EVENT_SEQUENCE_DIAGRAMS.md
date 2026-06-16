# Realtime Event Sequence Diagrams

## 1. Standard Connection & Authentication

```mermaid
sequenceDiagram
    participant Player
    participant WSS as WebSocket Server
    participant Redis as Redis Broker
    participant AuthAPI as Auth/State API

    Player->>WSS: TCP Connection Setup
    Player->>WSS: [WSS] HELLO { token, stateHash }
    WSS->>AuthAPI: [HTTPS] Verify JWT & fetch Device metadata
    alt Token Valid & State Matches
        AuthAPI-->>WSS: 200 OK + Device Context
        WSS->>Redis: SISMEMBER tenant, group, device
        WSS-->>Player: [WSS] AUTH_OK
    else Hash Mismatch
        AuthAPI-->>WSS: 200 OK + Mismatch Flag
        WSS-->>Player: [WSS] STATE_RESYNC_REQUIRED
        Player->>AuthAPI: [HTTPS] Fetch standard state
    else Token Invalid
        AuthAPI-->>WSS: 401 Unauthorized
        WSS-->>Player: [WSS] AUTH_FAIL
        WSS->>WSS: Terminate TCP Connection
    end
```

## 2. Emergency Override Fanout

```mermaid
sequenceDiagram
    participant Admin
    participant CoreAPI as CMS Core API
    participant DB as Postgres
    participant Redis as Redis Pub/Sub
    participant WSS1 as WS Node 1
    participant WSS2 as WS Node 2
    participant PlayerA
    participant PlayerB

    Admin->>CoreAPI: POST /api/v1/overrides (Emergency Group=ALL)
    CoreAPI->>DB: Insert Override Record (State = ACTIVE)
    CoreAPI->>Redis: PUBLISH tenant:123 OVERRIDE { payload }
    CoreAPI-->>Admin: 201 Created

    Redis-->>WSS1: Received channel tenant:123
    Redis-->>WSS2: Received channel tenant:123

    WSS1->>PlayerA: [WSS] OVERRIDE { payload }
    WSS2->>PlayerB: [WSS] OVERRIDE { payload }

    PlayerA->>WSS1: [WSS] ACK { status: "APPLIED" }
    PlayerB->>WSS2: [WSS] ACK { status: "APPLIED" }

    WSS1->>Redis: PUBLISH metrics:ack PlayerA ...
    WSS2->>Redis: PUBLISH metrics:ack PlayerB ...
```

## 3. All-Clear & State Restoration

```mermaid
sequenceDiagram
    participant Admin
    participant CoreAPI
    participant Redis
    participant WSS
    participant Player

    Admin->>CoreAPI: POST /api/v1/overrides/123/all-clear
    CoreAPI->>Redis: PUBLISH tenant:123 ALL_CLEAR { id }
    Redis-->>WSS: Fanout ALL_CLEAR
    WSS->>Player: [WSS] ALL_CLEAR { id }
    
    Player->>Player: Halt Override display
    Player->>Player: Re-verify local cache state hash
    Player->>Player: Execute scheduled playlist at current clock time
    Player->>WSS: [WSS] ACK { status: "RESTORED" }
```

## 4. Reconnection & Missed Override Recovery

```mermaid
sequenceDiagram
    participant Player
    participant WSS
    participant Redis
    participant CoreAPI
    
    Note over Player, WSS: Network Partition Occurs
    Note over CoreAPI, Redis: Admin triggers Override #99
    
    Player->>WSS: WSS Reconnect
    Player->>WSS: [WSS] HELLO { stateHash: "old_state" }
    WSS->>CoreAPI: Validate Token & State Hash
    CoreAPI-->>WSS: Mismatch detected! (Override #99 is active)
    WSS-->>Player: [WSS] STATE_RESYNC_REQUIRED { reason: "HASH_MISMATCH" }
    
    Player->>CoreAPI: [HTTPS] GET /api/v1/device/state
    CoreAPI-->>Player: { activeOverride: { id: 99, ... } }
    
    Player->>Player: Automatically render Override #99
    Player->>CoreAPI: [HTTPS] POST /api/v1/device/ack { event: 99 }
```
