#!/bin/bash
set -e

if [[ -d "modules/node" ]]
then cd modules/node
fi

########################################
# Convert secrets to env vars

if [[ -z "$INDRA_PG_PASSWORD" && -n "$INDRA_PG_PASSWORD_FILE" ]]
then export INDRA_PG_PASSWORD="`cat $INDRA_PG_PASSWORD_FILE`"
fi

if [[ -z "$INDRA_MNEMONIC" && -n "$INDRA_MNEMONIC_FILE" ]]
then export INDRA_MNEMONIC="`cat $INDRA_MNEMONIC_FILE`"
fi

if [[ -z "$INDRA_NATS_JWT_SIGNER_PRIVATE_KEY" && -n "$INDRA_NATS_JWT_SIGNER_PRIVATE_KEY_FILE" ]]
then export INDRA_NATS_JWT_SIGNER_PRIVATE_KEY="`cat $INDRA_NATS_JWT_SIGNER_PRIVATE_KEY_FILE`"
fi

if [[ -z "$INDRA_NATS_JWT_SIGNER_PUBLIC_KEY" && -n "$INDRA_NATS_JWT_SIGNER_PUBLIC_KEY_FILE" ]]
then export INDRA_NATS_JWT_SIGNER_PUBLIC_KEY="`cat $INDRA_NATS_JWT_SIGNER_PUBLIC_KEY_FILE`"
fi

########################################
# Wait for indra stack dependencies

function wait_for {
  name=$1
  target=$2
  tmp=${target#*://} # remove protocol
  host=${tmp%%/*} # remove path if present
  if [[ ! "$host" =~ .*:[0-9]{1,5} ]] # no port provided
  then
    echo "$host has no port, trying to add one.."
    if [[ "${target%://*}" == "http" ]]
    then host="$host:80"
    elif [[ "${target%://*}" == "https" ]]
    then host="$host:443"
    else echo "Error: missing port for host $host derived from target $target" && exit 1
    fi
  fi
  echo "Waiting for $name at $target ($host) to wake up..."
  wait-for -t 60 $host 2> /dev/null
}

wait_for "database" "$INDRA_PG_HOST:$INDRA_PG_PORT"
wait_for "nats" "$INDRA_NATS_SERVERS"
wait_for "redis" "$INDRA_REDIS_URL"

########################################
# Launch Node

if [[ "$NODE_ENV" == "development" ]]
then
  echo "Starting indra node in dev-mode"
  exec ./node_modules/.bin/nodemon \
    --delay 1 \
    --exitcrash \
    --ignore *.test.ts \
    --ignore *.swp \
    --legacy-watch \
    --polling-interval 1000 \
    --watch src \
    --exec ts-node \
    ./src/main.ts
else
  echo "Starting indra node in prod-mode"
  exec node --no-deprecation dist/bundle.js
fi

