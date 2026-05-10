# Zeek JSONL to Neo4j importer

Importe des logs Zeek JSONL dans Neo4j avec le modèle :

```text
(:Source)-[:SRC_OF]->(:Event)-[:DST_TO]->(:Destination)
```

Ce modèle est plus adapté aux filtres temporels et aux pivots Cytoscape qu'une relation directe unique.

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage rapide

```bash
python3 zeek_jsonl_to_neo4j.py --preview zeek/logs/conn.jsonl
python3 zeek_jsonl_to_neo4j.py --dry-run zeek/logs/conn.jsonl
python3 zeek_jsonl_to_neo4j.py zeek/logs/conn.jsonl
```

## Générer une config

```bash
python3 zeek_jsonl_to_neo4j.py --init-config zeek_neo4j_config.example.json
python3 zeek_jsonl_to_neo4j.py --config zeek_neo4j_config.example.json --dry-run
```

## Timestamp

Formats supportés :

```text
none
epoch_float
epoch_int
iso
python
```

Exemple Zeek :

```json
{
  "timestamp_enabled": true,
  "timestamp_field": "ts",
  "timestamp_format": "epoch_float",
  "timestamp_timezone": "UTC"
}
```

Exemple format Python :

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
  cli.py                            Arguments CLI
  config.py                         Config JSON + .env
  defaults.py                       Config par défaut
  identifiers.py                    Labels, propriétés, identifiants Cypher
  jsonl.py                          Lecture JSONL, flatten, preview
  timeparse.py                      Parsing timestamp
  model.py                          Transformation record -> row Neo4j
  cypher.py                         Fragments Cypher
  neo4j_client.py                   Connexion, contraintes, import, delete
  interactive.py                    Configuration interactive
```

## Supprimer un import

```bash
python3 zeek_jsonl_to_neo4j.py --config zeek_neo4j_config.example.json --delete-import
```


## Profils netgraph

Les profils sont stockés dans :

```text
netgraph_profiles/*.json
```

Ils permettent de sauvegarder/recharger un mapping de log, par exemple :

```text
conn_profile.json   IP -> ConnEvent -> IP
dns_profile.json    IP -> DnsEvent -> Domain
http_profile.json   IP -> HttpEvent -> Host/URI
ssl_profile.json    IP -> SslEvent -> ServerName
```

Migrer les anciens profils vers le modèle `Source -> Event -> Destination` :

```bash
python3 zeek_jsonl_to_neo4j.py --migrate-profiles
```

Pendant la configuration interactive, le script propose maintenant de charger un profil existant et de sauvegarder le mapping courant comme profil.
