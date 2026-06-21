# SPDX-License-Identifier: Apache-2.0
# QuickSense Spark Connect execution broker. Runs on the QuickSense Spark image
# (which already carries pyspark[connect]) and adds only the stdlib broker
# server — no extra runtime deps, air-gapped.
ARG SPARK_IMAGE=quicksense-spark:latest
FROM ${SPARK_IMAGE}
COPY docker/broker/broker.py /opt/broker/broker.py
EXPOSE 8099
ENTRYPOINT ["python3", "/opt/broker/broker.py"]
