-- Separate databases so automated tests and the demo never touch development data.
CREATE DATABASE clientflow_test;
CREATE DATABASE clientflow_e2e;
CREATE DATABASE clientflow_demo;
