# SPDX-License-Identifier: Apache-2.0

FROM apache/spark:4.0.3-scala2.13-java17-python3-r-ubuntu

USER root

ARG ICEBERG_VERSION=1.10.0

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    rm -rf /var/lib/apt/lists/*; \
    curl -fsSL -o /opt/spark/jars/iceberg-spark-runtime-4.0_2.13-${ICEBERG_VERSION}.jar \
      "https://repo1.maven.org/maven2/org/apache/iceberg/iceberg-spark-runtime-4.0_2.13/${ICEBERG_VERSION}/iceberg-spark-runtime-4.0_2.13-${ICEBERG_VERSION}.jar"; \
    curl -fsSL -o /opt/spark/jars/iceberg-aws-bundle-${ICEBERG_VERSION}.jar \
      "https://repo1.maven.org/maven2/org/apache/iceberg/iceberg-aws-bundle/${ICEBERG_VERSION}/iceberg-aws-bundle-${ICEBERG_VERSION}.jar"

# Spark Connect CLIENT deps only (the image already bundles pyspark at
# /opt/spark/python; we just need the gRPC/arrow/pandas runtime so a script can
# act as a `sc://` Connect client via SC_REMOTE). Installing the extras directly
# (not the full pyspark[connect], which re-downloads pyspark) keeps the layer small.
RUN pip install --no-cache-dir \
      grpcio grpcio-status googleapis-common-protos \
      'pandas>=2.2.0' 'pyarrow>=11.0.0' numpy

COPY docker/spark/spark-defaults.conf /opt/spark/conf/spark-defaults.conf.template
COPY docker/spark/render-spark-defaults.sh /usr/local/bin/render-spark-defaults.sh

RUN chmod +x /usr/local/bin/render-spark-defaults.sh \
    && chown -R spark:spark /opt/spark/conf

USER spark
