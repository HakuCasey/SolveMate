CREATE TABLE download_counts (
    version TEXT NOT NULL,
    target TEXT NOT NULL,
    source TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (version, target, source)
) STRICT;
