"""Build the validated MVP case matrix from the selected-case configuration."""

import argparse
from pathlib import Path

from backend.app.case_matrix import (
    build_case_matrix,
    write_case_matrix_csv,
    write_case_matrix_json,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "selection",
        type=Path,
        help="JSON file listing the selected cases, states, and parameter rules",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        required=True,
        help="Destination for the nested runtime case matrix",
    )
    parser.add_argument(
        "--output-csv",
        type=Path,
        required=True,
        help="Destination for the flat human-readable case matrix",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path.cwd(),
        help="Root used to resolve project-relative paths (default: current directory)",
    )
    args = parser.parse_args()

    try:
        matrix = build_case_matrix(args.selection, args.project_root)
        write_case_matrix_json(matrix, args.output_json)
        write_case_matrix_csv(matrix, args.output_csv)
    except ValueError as error:
        parser.error(str(error))

    summary = matrix["summary"]
    print(
        f"Built {summary['case_count']} cases and {summary['state_count']} states; "
        f"JSON: {args.output_json}; CSV: {args.output_csv}"
    )


if __name__ == "__main__":
    main()
