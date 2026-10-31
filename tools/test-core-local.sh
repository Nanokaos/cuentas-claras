#!/usr/bin/env bash
# Compila y ejecuta las pruebas de :core sin Gradle ni red, con el Kotlin incluido en Gradle 8.14.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
L=${GRADLE_LIB:-/opt/gradle/lib}
OUT=$(mktemp -d)
COMPILER_CP=$(ls $L/kotlin*.jar $L/trove4j*.jar $L/annotations-24*.jar | tr '\n' ':')
RT="$L/kotlin-stdlib-2.0.21.jar:$L/junit-4.13.2.jar:$L/hamcrest-core-1.3.jar"
java -cp "$COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
  -cp "$RT" -d "$OUT" $(find "$ROOT/core/src/main" "$ROOT/core/src/test" -name '*.kt') 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
CLASSES=$(cd "$OUT" && find . -name '*Test.class' | sed 's|^\./||;s|\.class$||;s|/|.|g')
java -cp "$OUT:$RT" org.junit.runner.JUnitCore $CLASSES 2>&1 | grep -v JAVA_TOOL_OPTIONS
