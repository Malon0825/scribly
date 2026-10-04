// Templates are ordinary diagrams. They have no hosted service or runtime dependency.
export const boardTemplates = [
  { id: "web", title: "Web application", description: "Client, API, cache and database across deployment boundaries.", code: `flowchart LR
  client["Web client"]
  subgraph application["Application server"]
    api["API service"]
    cache["Cache"]
  end
  subgraph data["Data server"]
    database["Database"]
  end
  client -->|HTTPS| api
  api --> cache
  api -->|Read / write| database` },
  { id: "events", title: "Event processing", description: "Producer, queue and worker with a separate data boundary.", code: `flowchart LR
  subgraph services["Services"]
    producer["Producer"]
    worker["Worker"]
  end
  subgraph messaging["Messaging"]
    queue["Event queue"]
  end
  subgraph storage["Storage"]
    database["Database"]
  end
  producer -->|Publish| queue
  queue -->|Consume| worker
  worker -->|Persist| database` },
  { id: "replication", title: "Database replication", description: "Source, extract, replicate and destination on three servers.", code: `flowchart LR
  subgraph a["Server A"]
    source["Source database"]
  end
  subgraph b["Server B"]
    extract["Extract + pump"]
    replicat["Replicat"]
  end
  subgraph c["Server C"]
    destination["Destination database"]
  end
  source <--> extract
  extract --> replicat
  replicat --> destination` },
  { id: "deployment", title: "Nested deployment", description: "Region and service boundaries containing an API and worker.", code: `flowchart LR
  client["Client"]
  subgraph region["Region"]
    subgraph services["Service cluster"]
      api["API"]
      worker["Worker"]
    end
    database["Database"]
  end
  client --> api
  api --> worker
  worker --> database` },
] as const;
