#!/bin/sh
# Start Litestream with the R2 keys from the Mac keychain (never written to a file). Katie adds them once, herself:
#   security add-generic-password -s appreciation-r2 -a account_id -w
#   security add-generic-password -s appreciation-r2 -a access_key_id -w
#   security add-generic-password -s appreciation-r2 -a secret_access_key -w
k() { security find-generic-password -s appreciation-r2 -a "$1" -w 2>/dev/null || { echo "missing keychain item: $1"; exit 1; }; }
export CF_ACCOUNT_ID=$(k account_id) LITESTREAM_ACCESS_KEY_ID=$(k access_key_id) LITESTREAM_SECRET_ACCESS_KEY=$(k secret_access_key)
exec litestream replicate -config "/Users/katiegraves/Desktop/Fashion Data Lab/cloud/litestream.yml"
