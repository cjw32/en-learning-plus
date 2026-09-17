#!/bin/sh
set -eu
docker pull public.ecr.aws/docker/library/postgres:17-alpine@sha256:7456ef82e5f5bc43d997f4781bbd7c0d6389bff397564649a356e206ba473aee
docker pull ghcr.io/reactive-resume/reactive-resume:v5.3.0@sha256:828dd46b21bf922ffaac870c7cf5895d97bc4b1f48e2eb08880284d241de4d35
echo 'CJW_RESUME_IMAGES_READY'
