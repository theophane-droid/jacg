# JACG - Just a Cyber Graph
![JACG graph visualization example](docs/image.png)

PoC for graph visualisation of investigation data. Has been mainly tried on zeek.

Import JSONL logs into Neo4j for advanced visualisation.

## Requirements

- Docker
- Docker Compose
- Python 3

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
docker compose up -d
```

## Quick Usage

```bash
python3 zeek_jsonl_to_neo4j.py --preview zeek/logs/conn.jsonl
python3 zeek_jsonl_to_neo4j.py --dry-run zeek/logs/conn.jsonl
python3 zeek_jsonl_to_neo4j.py zeek/logs/conn.jsonl
```

## Generate a Config

```bash
python3 zeek_jsonl_to_neo4j.py --init-config zeek_neo4j_config.example.json
python3 zeek_jsonl_to_neo4j.py --config zeek_neo4j_config.example.json --dry-run
```

## Timestamp

Supported formats:

```text
none
epoch_float
epoch_int
iso
python
```

Zeek example:

```json
{
  "timestamp_enabled": true,
  "timestamp_field": "ts",
  "timestamp_format": "epoch_float",
  "timestamp_timezone": "UTC"
}
```

Python format example:

```json
{
  "timestamp_enabled": true,
  "timestamp_field": "timestamp",
  "timestamp_format": "python",
  "timestamp_python_format": "%Y-%m-%d %H:%M:%S",
  "timestamp_timezone": "Europe/Paris"
}
```

## Structure

```text
zeek_jsonl_to_neo4j.py              Entrypoint
zeek_neo4j_importer/
  cli.py                            CLI arguments
  config.py                         JSON config + .env
  defaults.py                       Default config
  identifiers.py                    Labels, properties, Cypher identifiers
  jsonl.py                          JSONL reading, flattening, preview
  timeparse.py                      Timestamp parsing
  model.py                          Record -> Neo4j row transformation
  cypher.py                         Cypher fragments
  neo4j_client.py                   Connection, constraints, import, delete
  interactive.py                    Interactive configuration
```

## Delete an Import

```bash
python3 zeek_jsonl_to_neo4j.py --config zeek_neo4j_config.example.json --delete-import
```


## Netgraph Profiles

Profiles are stored in:

```text
netgraph_profiles/*.json
```

They save and reload log mappings, for example:

```text
conn_profile.json   IP -> ConnEvent -> IP
dns_profile.json    IP -> DnsEvent -> Domain
http_profile.json   IP -> HttpEvent -> Host/URI
ssl_profile.json    IP -> SslEvent -> ServerName
```

Migrate older profiles to the `Source -> Event -> Destination` model:

```bash
python3 zeek_jsonl_to_neo4j.py --migrate-profiles
```

During interactive configuration, the script can load an existing profile and save the current mapping as a profile.
