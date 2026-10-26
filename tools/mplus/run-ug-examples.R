# Run selected Mplus User's Guide examples through MplusAutomation, on copies,
# with OUTPUT: STANDARDIZED added (unless the input already asks for it) and
# /diagram passed via a wrapper command, so each run writes .out and .dgm.
# Never touches the Mplus installation or the pristine example copies.
#
# Usage: Rscript tools/mplus/run-ug-examples.R <run_dir> <after|before> <ex1> [ex2 ...]
#
#   run_dir   a folder inside docs/reference/, normally
#             docs/reference/mplus-runs/<name>; never docs/reference/ itself
#             and never anything under docs/reference/mplus-ug-examples/
#   after     the wrapper passes the input file, then /diagram
#   before    the wrapper passes /diagram, then the input file
#   ex1 ...   example names without .inp (ex5.1); only these are run
#
# The MplusAutomation log is written to <run_dir>/runModels.log.
suppressPackageStartupMessages(library(MplusAutomation))

usage <- paste(
  "Usage: Rscript tools/mplus/run-ug-examples.R <run_dir> <after|before>",
  "<example> [example ...]"
)
is_windows <- .Platform$OS.type == "windows"

# The script's own path, from the --file= argument Rscript passes.
script_file <- function() {
  arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  if (length(arg) != 1) stop("Run this script with Rscript. ", usage, call. = FALSE)
  # Rscript on Windows passes spaces in the script path as "~+~".
  path <- gsub("~+~", " ", sub("^--file=", "", arg), fixed = TRUE)
  normalizePath(path, winslash = "/", mustWork = TRUE)
}

# Absolute, forward-slash form of a path that may not exist yet. "." and ".."
# are resolved lexically; the longest existing prefix then goes through
# normalizePath, so it compares like the real folder.
abs_path <- function(p) {
  p <- gsub("\\\\", "/", p)
  if (!grepl("^([A-Za-z]:)?/", p)) p <- paste0(getwd(), "/", p)
  lead <- if (startsWith(p, "/")) "/" else ""
  join <- function(x) {
    s <- paste0(lead, paste(x, collapse = "/"))
    if (grepl(":$", s)) paste0(s, "/") else s
  }
  parts <- character()
  for (s in strsplit(p, "/", fixed = TRUE)[[1]]) {
    if (s == "" || s == ".") next
    if (s == "..") {
      n <- length(parts)
      if (n > 0 && !grepl(":$", parts[n])) parts <- parts[-n]
    } else {
      parts <- c(parts, s)
    }
  }
  rest <- character()
  while (length(parts) > 1 && !dir.exists(join(parts))) {
    rest <- c(parts[length(parts)], rest)
    parts <- parts[-length(parts)]
  }
  head <- sub("/$", "", normalizePath(join(parts), winslash = "/", mustWork = FALSE))
  paste(c(head, rest), collapse = "/")
}

# TRUE when path is dir itself (or_same) or lies below it.
under <- function(path, dir, or_same = FALSE) {
  if (is_windows) {
    path <- tolower(path)
    dir <- tolower(dir)
  }
  (or_same && path == dir) || startsWith(path, paste0(dir, "/"))
}

# --- Arguments ---------------------------------------------------------------

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 3) stop(usage, call. = FALSE)

variant <- args[2]
if (!variant %in% c("after", "before")) {
  stop("wrapper variant must be 'after' or 'before', not '", variant, "'. ",
       usage, call. = FALSE)
}

examples <- unique(args[-(1:2)])
bad <- examples[!grepl("^[A-Za-z0-9][A-Za-z0-9._-]*$", examples)]
if (length(bad) > 0) {
  stop("example names are file names without .inp and without a folder ",
       "(ex5.1); refused: ", paste(bad, collapse = ", "), call. = FALSE)
}

# --- Paths -------------------------------------------------------------------

# The script lives in <repo>/tools/mplus/.
repo <- dirname(dirname(dirname(script_file())))
ref_dir <- file.path(repo, "docs/reference")
pristine_dir <- file.path(ref_dir, "mplus-ug-examples")
src_dir <- file.path(pristine_dir, "inputs")
mplus_exe <- "C:\\Program Files\\Mplus\\Mplus.exe"

if (!dir.exists(src_dir)) {
  stop("example inputs not found at ", src_dir,
       " (see docs/reference/README.md)", call. = FALSE)
}
if (!file.exists(mplus_exe)) stop("Mplus not found at ", mplus_exe, call. = FALSE)

run_dir <- abs_path(args[1])
if (!under(run_dir, ref_dir)) {
  stop("run_dir must be a folder inside ", ref_dir,
       " (normally docs/reference/mplus-runs/<name>), not ", run_dir,
       call. = FALSE)
}
if (under(run_dir, pristine_dir, or_same = TRUE)) {
  stop("run_dir must not be inside the pristine example copies (",
       pristine_dir, "): ", run_dir, call. = FALSE)
}

inp_src <- file.path(src_dir, paste0(examples, ".inp"))
absent <- examples[!file.exists(inp_src)]
if (length(absent) > 0) {
  stop("no such example in ", src_dir, ": ", paste(absent, collapse = ", "),
       call. = FALSE)
}

dir.create(run_dir, recursive = TRUE, showWarnings = FALSE)
if (!dir.exists(run_dir)) stop("could not create run_dir: ", run_dir, call. = FALSE)

# --- Helpers for the input files ---------------------------------------------

# A line that opens an Mplus command (DATA:, MODEL:, MODEL g2:, OUTPUT: ...).
command_re <- paste0(
  "(?i)^\\s*(TITLE|DATA|VARIABLE|DEFINE|ANALYSIS|MODEL|OUTPUT|SAVEDATA|PLOT|",
  "MONTECARLO)\\b[^:;]*:"
)

# Line numbers of the command whose header matches header_re: its header line
# up to the line before the next command header. `code` has comments removed.
command_lines <- function(code, header_re) {
  start <- grep(header_re, code, perl = TRUE)
  if (length(start) == 0) return(integer())
  start <- start[1]
  later <- grep(command_re, code, perl = TRUE)
  later <- later[later > start]
  end <- if (length(later) > 0) later[1] - 1 else length(code)
  start:end
}

# TRUE for a bare file name: no folder part, so a copy stays inside run_dir
# and can never resolve to the source file itself.
is_bare_name <- function(name) {
  grepl("^[A-Za-z0-9_][A-Za-z0-9_.-]*$", name) && !name %in% c(".", "..")
}

# Copy one file from the example inputs into the run folder, checked, since
# file.copy can fail without an error.
copy_input <- function(name) {
  if (!is_bare_name(name)) {
    stop("refusing to copy a data file name with a folder part: ", name, call. = FALSE)
  }
  to <- file.path(run_dir, name)
  ok <- file.copy(file.path(src_dir, name), to, overwrite = TRUE)
  if (!ok || !file.exists(to)) stop("copy failed: ", name, call. = FALSE)
}

# Every file in src_dir that the input names anywhere outside comments (DATA
# FILE, MONTECARLO POPULATION / COVERAGE, SWMATRIX and so on): any token that
# is the name of a file there. Names with spaces are not supported.
named_files <- function(code, src_dir) {
  tokens <- unlist(strsplit(gsub('"', " ", code), "[[:space:]=;,]+"))
  tokens <- unique(tokens[nzchar(tokens) & vapply(tokens, is_bare_name, logical(1))])
  tokens[file.exists(file.path(src_dir, tokens)) & !dir.exists(file.path(src_dir, tokens))]
}

# The file names listed in `path`, one per line (an imputation list, a
# replication list, a SWMATRIX list), or NULL when it is not such a list.
listed_files <- function(path) {
  entry_re <- "^[A-Za-z0-9_][A-Za-z0-9_.-]*\\.[A-Za-z0-9]+$"
  # A data file is recognised from its first line without reading it all.
  first <- trimws(gsub('"', "", readLines(path, n = 1, warn = FALSE)))
  if (length(first) == 0 || !grepl(entry_re, first) || !grepl("[A-Za-z]", first)) return(NULL)
  lines <- trimws(gsub('"', "", readLines(path, warn = FALSE)))
  lines <- lines[nzchar(lines)]
  if (all(grepl(entry_re, lines) & grepl("[A-Za-z]", lines))) lines else NULL
}

# All files to copy for one input: the files it names, and the entries of any
# of those that is a list of files (recursively). Stops when a list names a
# file that is missing from src_dir, which Mplus would fail on.
files_to_copy <- function(code, src_dir) {
  queue <- named_files(code, src_dir)
  done <- character()
  while (length(queue) > 0) {
    name <- queue[1]
    queue <- queue[-1]
    if (name %in% done) next
    done <- c(done, name)
    listed <- listed_files(file.path(src_dir, name))
    missing <- listed[!file.exists(file.path(src_dir, listed))]
    if (length(missing) > 0) {
      stop("files listed in ", name, " not found in ", src_dir, ": ",
           paste(missing, collapse = ", "), call. = FALSE)
    }
    queue <- c(queue, listed)
  }
  done
}

# --- Prepare the copies ------------------------------------------------------

# Wrapper so runModels (which only passes the input file) also passes /diagram.
wrapper <- file.path(run_dir, "mplus-diagram.cmd")
line <- if (variant == "before") {
  sprintf('@"%s" /diagram %%1', mplus_exe)
} else {
  sprintf('@"%s" %%1 /diagram', mplus_exe)
}
writeLines(line, wrapper)

for (i in seq_along(examples)) {
  ex <- examples[i]
  txt <- readLines(inp_src[i], warn = FALSE)
  code <- sub("!.*$", "", txt)

  # Copy every file the input names, and the files any list among them names.
  for (name in files_to_copy(code, src_dir)) copy_input(name)

  # Outputs of an earlier run would pass for this run's in the summary.
  for (ext in c(".out", ".dgm")) {
    old <- file.path(run_dir, paste0(ex, ext))
    if (file.exists(old) && !file.remove(old)) stop("could not remove ", old, call. = FALSE)
  }

  # Add STANDARDIZED to OUTPUT (create the command if absent), unless OUTPUT
  # already asks for it (STANDARDIZED, an abbreviation of it, or STDYX).
  out_lines <- command_lines(code, "(?i)^\\s*OUTPUT\\s*:")
  if (length(out_lines) == 0) {
    txt <- c(txt, "OUTPUT: STANDARDIZED;")
  } else if (!any(grepl("(?i)\\b(STAN\\w*|STDYX)\\b", code[out_lines], perl = TRUE))) {
    # STANDARDIZED goes on the header line and the rest of that line moves to
    # the next one, so no line grows past Mplus's line-length limit.
    h <- out_lines[1]
    rest <- sub("(?i)^\\s*OUTPUT\\s*:", "", txt[h], perl = TRUE)
    txt[h] <- "OUTPUT: STANDARDIZED;"
    if (nzchar(trimws(rest))) txt <- append(txt, rest, after = h)
  }
  writeLines(txt, file.path(run_dir, paste0(ex, ".inp")))
}

# Run only the examples given, not every .inp left in run_dir. The pattern
# matches a whole file name whether runModels tests the name or a full path,
# ignoring case as Windows file names do (an earlier run's `ex5.1.inp` keeps
# its spelling when `EX5.1` is written over it); runModels greps with perl.
filefilter <- paste0(
  "(?i)(^|[/\\\\])(", paste(gsub("\\.", "\\\\.", examples), collapse = "|"), ")\\.inp$"
)
# killOnFail = FALSE: on failure MplusAutomation would otherwise run
# `taskkill /f /im mplus.exe`, killing every Mplus process on the machine.
runModels(run_dir, filefilter = filefilter, Mplus_command = wrapper,
          showOutput = FALSE, replaceOutfile = "always", killOnFail = FALSE,
          logFile = file.path(run_dir, "runModels.log"), quiet = TRUE)

for (ex in examples) {
  out <- file.path(run_dir, paste0(ex, ".out"))
  dgm <- file.path(run_dir, paste0(ex, ".dgm"))
  cat(sprintf("%-7s out:%s dgm:%s", ex, file.exists(out), file.exists(dgm)))
  if (file.exists(out)) {
    m <- suppressWarnings(readModels(out, quiet = TRUE))
    secs <- names(m$parameters)
    errs <- length(m$errors)
    cat(sprintf("  parameter sections: %s  errors: %d", paste(secs, collapse = ","), errs))
  }
  cat("\n")
}
